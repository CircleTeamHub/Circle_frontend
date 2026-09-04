import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytesAsync } from 'expo-crypto';
import type { ChatConversationDto, ChatMessageDto } from './protocol';
import { reportHandledFailure } from '@/observability/report-failure';

/**
 * G-01 本地持久化:把 OpenIM SDK 当年内置的本地消息库补回来。
 *
 * 设计约束:
 * - **缓存性质**:这里的一切都是服务端数据的本地镜像 + 待发队列,任何失败都
 *   吞掉降级(返回 null/[]/false),绝不允许本地库故障影响聊天主链路。
 * - **按账号分库**:文件名带 userId,切号天然隔离,不需要清库竞态处理。
 * - **加密**:app.json 已开 expo-sqlite 的 SQLCipher;钥匙走 SecureStore
 *   (与 MMKV encrypted-init 同款 32 字节随机 hex,独立键名)。运行在没编译
 *   SQLCipher 的旧 dev-client 上时 PRAGMA 不生效 —— 记一次警告并继续
 *   (真机重装含插件的构建后自动加密;cipher 可用性由 PRAGMA cipher_version 探测)。
 * - **FTS5 可选**:建虚表失败(极老构建)自动回退 LIKE 搜索。
 * - 墓碑(deleted-messages)仍留在 MMKV:它需要同步读且已有迁移史,本批不动。
 */

const DB_KEY_STORE_KEY = 'circle-im-chatdb-encryption-key';
const KEYCHAIN_ACCESS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
} as const;

/** 每会话本地保留的消息上限(超出删最旧;更早历史回落 REST 翻页)。 */
const RETENTION_PER_CONVERSATION = 500;
const SCHEMA_VERSION = 2;

interface DbHandle {
  db: SQLite.SQLiteDatabase;
  userId: string;
  ftsAvailable: boolean;
  encrypted: boolean;
}

let handle: DbHandle | null = null;
let opening: Promise<DbHandle | null> | null = null;

const warn = (() => {
  const seen = new Set<string>();
  return (key: string, message: string, error?: unknown) => {
    if (seen.has(key)) return;
    seen.add(key);
    // 本地库是缓存,任何失败都降级吞掉 —— 但「吞掉」不等于「无声」:每种失败每个
    // 进程留一次信号(reportHandledFailure 自身还会按签名去重)。console.warn 不走
    // devWarn:这里是本模块唯一的输出口,测试靠它观测降级路径。
    console.warn(message, error ?? '');
    reportHandledFailure('chatLocalDb', key, error ?? new Error(message));
  };
})();

async function readOrCreateDbKey(): Promise<string | null> {
  try {
    const existing = await SecureStore.getItemAsync(DB_KEY_STORE_KEY);
    if (existing) return existing;
    const bytes = await getRandomBytesAsync(32);
    const key = Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    await SecureStore.setItemAsync(DB_KEY_STORE_KEY, key, KEYCHAIN_ACCESS);
    return key;
  } catch (error) {
    warn('key', '[chat-db] encryption key unavailable', error);
    return null;
  }
}

function dbFileName(userId: string): string {
  // userId 是 UUID(合法文件名字符);带版本号方便未来整库重建。
  return `chat-core-v1-${userId}.db`;
}

async function applySchema(db: SQLite.SQLiteDatabase): Promise<boolean> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      last_message_at TEXT,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      height INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT,
      payload TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conv_height
      ON messages(conversation_id, height);
    CREATE TABLE IF NOT EXISTS sync_state (
      conversation_id TEXT PRIMARY KEY,
      min_height INTEGER NOT NULL,
      max_height INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbox (
      d TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      failed_after_height INTEGER
    );
    CREATE TABLE IF NOT EXISTS pending_reads (
      conversation_id TEXT PRIMARY KEY,
      height INTEGER NOT NULL
    );
  `);
  const outboxColumns = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(outbox);',
  );
  if (!outboxColumns.some((column) => column.name === 'failed_after_height')) {
    await db.execAsync(
      'ALTER TABLE outbox ADD COLUMN failed_after_height INTEGER;',
    );
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  // FTS5 与触发器单独建:老构建缺 FTS5 时只损失离线搜索,不影响其余表。
  try {
    await db.execAsync(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
        USING fts5(text, content='messages', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text)
          VALUES ('delete', old.rowid, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text)
          VALUES ('delete', old.rowid, old.text);
        INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `);
    return true;
  } catch (error) {
    warn('fts', '[chat-db] FTS5 unavailable; falling back to LIKE search', error);
    return false;
  }
}

/**
 * 打开(或复用)当前账号的本地库。幂等:同账号重复调用直接返回;
 * 切号时先 close 旧库再开新文件。
 */
export async function initChatLocalDb(userId: string): Promise<boolean> {
  if (handle?.userId === userId) return true;
  if (opening) await opening.catch(() => null);
  if (handle?.userId === userId) return true;
  opening = (async (): Promise<DbHandle | null> => {
    try {
      if (handle) await releaseHandle(handle);
      // finalizeUnusedStatementsBeforeClosing 必须关掉(默认 true)。
      //
      // 它在关库前遍历 sqlite3_next_stmt 把连接上**所有**语句 finalize 一遍,
      // 其中包括 FTS5 虚表内部自己持有的那些;紧接着 sqlite3_close 走
      // fts5DisconnectMethod → sqlite3Fts5IndexClose 又 finalize 一次 ——
      // 二次释放,EXC_BAD_ACCESS。触发点是 app context 销毁(dev 下的 reload、
      // 退出)时 expo-sqlite 的 OnDestroy 强制关库,表现为整个 App 闪退。
      // 上游 issue: https://github.com/expo/expo/issues/38168
      //
      // 关掉它对我们无损:本模块只用 runAsync/getFirstAsync/getAllAsync/execAsync
      // (自带 finalize),从不手工 prepareAsync,没有需要它兜底的语句。
      const db = await SQLite.openDatabaseAsync(dbFileName(userId), {
        finalizeUnusedStatementsBeforeClosing: false,
      });
      let encrypted = false;
      const key = await readOrCreateDbKey();
      if (key) {
        try {
          await db.execAsync(`PRAGMA key = "x'${key}'";`);
          const row = await db.getFirstAsync<{ cipher_version?: string }>(
            'PRAGMA cipher_version;',
          );
          encrypted = Boolean(row && row.cipher_version);
        } catch {
          encrypted = false;
        }
      }
      // 拿不到密钥、或 SQLCipher 没生效(OTA 跑在旧二进制上)时**不建库**。
      //
      // 原来只是 warn 一声就继续建:那会在磁盘上落一个明文的库文件,里面是
      // 私聊正文、会话元信息、outbox 里还没发出去的内容和待上报的已读水位。
      // 之后即使重新构建了带 SQLCipher 的包,已经写下的明文文件也不会被
      // 追溯加密。本地缓存是可选的加速层,不值得拿这个换。
      if (!encrypted) {
        warn(
          'cipher',
          key
            ? '[chat-db] SQLCipher not active (old build?); local cache disabled — rebuild the app with the expo-sqlite plugin'
            : '[chat-db] no SecureStore key; local cache disabled',
        );
        await db.closeAsync().catch(() => undefined);
        handle = null;
        return null;
      }
      const ftsAvailable = await applySchema(db);
      const next: DbHandle = { db, userId, ftsAvailable, encrypted };
      handle = next;
      return next;
    } catch (error) {
      warn('open', '[chat-db] open failed; running without local cache', error);
      handle = null;
      return null;
    }
  })();
  const result = await opening;
  opening = null;
  return result !== null;
}

export async function closeChatLocalDb(): Promise<void> {
  if (handle) await releaseHandle(handle);
}

/**
 * 摘句柄 → 等积压写完 → 关连接。切号与登出都走这里。
 *
 * 顺序是关键(codex review)。原来是直接 `closeAsync()`:写队列里排着的回调
 * 仍握着那个刚被关掉的连接,轮到它们时一律抛错,而 outbox / 已读水位这些
 * 写入方都是 `warn` 一声吞掉 —— 丢的是上一个账号**还没发出去的消息**和待
 * 上报的已读位置,用户那边没有任何提示。
 *
 * 先把 handle 摘掉再 drain,循环才一定收敛:此后新的写入方在 requireDb() 就
 * 拿到 null 直接返回,不会再往旧库排队(每个写入方都是 requireDb() 之后
 * **同步**入队的,不存在跨 await 的窗口)。
 */
async function releaseHandle(current: DbHandle): Promise<void> {
  handle = null;
  // 队列在 await 期间还可能被追加(摘句柄那一刻已经进到队里的),等到它不再变。
  let drained: Promise<unknown> | null = null;
  while (drained !== writeQueue) {
    drained = writeQueue;
    await drained.catch(() => undefined);
  }
  await current.db.closeAsync().catch(() => undefined);
}

function requireDb(): DbHandle | null {
  return handle;
}

/**
 * 写事务串行化队列。
 *
 * expo-sqlite 的 `withTransactionAsync` 文档明写「非独占,会被其它 async
 * 查询打断」:同一条连接上两个并发调用,第二个 BEGIN 直接撞
 * `cannot start a transaction within a transaction`,那一整批写入被吞掉。
 * 重连对账(多个会话的历史同时回来)就是这个形状。
 *
 * 不改用 `withExclusiveTransactionAsync`:它另开一条连接,只是把嵌套事务
 * 换成 `database is locked`,而且 web 不支持。本模块是本地库的唯一入口,
 * 在 JS 侧排队最直接。
 *
 * 注意:排队的任务里不能再调 writeTransaction —— 内层会等一条永远轮不到
 * 自己的队列(死锁)。目前每个事务体只发 db 语句,没有互相调用。
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  // 前一批失败不能卡住后面的:队列本身只保序,不传播结果。
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function writeTransaction(
  db: SQLite.SQLiteDatabase,
  task: () => Promise<void>,
): Promise<void> {
  return enqueueWrite(() => db.withTransactionAsync(task));
}

/**
 * 单条写入也必须排进同一条队列。
 *
 * SQLite 里一条裸 `runAsync` 如果正好落在别的事务打开着的窗口里,会**被算进
 * 那个事务** —— 那个事务回滚,这条写入跟着一起没。真实后果:消息发成功后
 * `outboxDelete` 撞进回声的 `persistLocalMessages` 事务,该事务当时因为
 * 嵌套 BEGIN 失败而 ROLLBACK,于是 outbox 行留了下来,那条已经发出去的消息
 * 从此每次冷启动都显示「发送失败」。
 */
function writeStatement<T>(task: () => Promise<T>): Promise<T> {
  return enqueueWrite(task);
}

/** 会话快照整体落盘(全量拉取语义:先清后写,单事务)。 */
export async function persistLocalConversations(
  conversations: ChatConversationDto[],
): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeTransaction(current.db, async () => {
      await current.db.runAsync('DELETE FROM conversations;');
      for (const conversation of conversations) {
        await current.db.runAsync(
          'INSERT OR REPLACE INTO conversations (id, last_message_at, payload) VALUES (?, ?, ?);',
          conversation.id,
          conversation.lastMessageAt ?? null,
          JSON.stringify(conversation),
        );
      }
    });
  } catch (error) {
    warn('conv-write', '[chat-db] persist conversations failed', error);
  }
}

export async function upsertLocalConversation(
  conversation: ChatConversationDto,
): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeStatement(() =>
      current.db.runAsync(
        'INSERT OR REPLACE INTO conversations (id, last_message_at, payload) VALUES (?, ?, ?);',
        conversation.id,
        conversation.lastMessageAt ?? null,
        JSON.stringify(conversation),
      ),
    );
  } catch (error) {
    warn('conv-upsert', '[chat-db] upsert conversation failed', error);
  }
}

export async function removeLocalConversation(
  conversationId: string,
): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeTransaction(current.db, async () => {
      await current.db.runAsync(
        'DELETE FROM conversations WHERE id = ?;',
        conversationId,
      );
      await current.db.runAsync(
        'DELETE FROM messages WHERE conversation_id = ?;',
        conversationId,
      );
      await current.db.runAsync(
        'DELETE FROM sync_state WHERE conversation_id = ?;',
        conversationId,
      );
    });
  } catch (error) {
    warn('conv-remove', '[chat-db] remove conversation failed', error);
  }
}

export async function readLocalConversations(): Promise<ChatConversationDto[]> {
  const current = requireDb();
  if (!current) return [];
  try {
    const rows = await current.db.getAllAsync<{ payload: string }>(
      'SELECT payload FROM conversations;',
    );
    const parsed: ChatConversationDto[] = [];
    for (const row of rows) {
      try {
        parsed.push(JSON.parse(row.payload) as ChatConversationDto);
      } catch {
        // 单行坏 JSON 丢弃即可。
      }
    }
    return parsed;
  } catch (error) {
    warn('conv-read', '[chat-db] read conversations failed', error);
    return [];
  }
}

function searchableTextOf(message: ChatMessageDto): string | null {
  if (message.type !== 'text' && message.type !== 'quote') return null;
  const text =
    typeof message.content['text'] === 'string'
      ? (message.content['text'] as string)
      : '';
  const quoted =
    typeof message.content['quotedText'] === 'string'
      ? (message.content['quotedText'] as string)
      : '';
  const merged = [text, quoted].filter(Boolean).join('\n');
  return merged.length > 0 ? merged : null;
}

/**
 * 消息落盘(广播/ack 回执/历史页/补拉共用的唯一入口;height=0 的乐观消息不进库,
 * 它们由 outbox 负责)。同事务内维护 sync_state 区间并做每会话保留上限修剪。
 */
export async function persistLocalMessages(
  conversationId: string,
  incoming: ChatMessageDto[],
): Promise<void> {
  const current = requireDb();
  if (!current) return;
  const rows = incoming.filter((m) => m.height > 0);
  if (rows.length === 0) return;
  try {
    await writeTransaction(current.db, async () => {
      for (const message of rows) {
        // ON CONFLICT DO UPDATE 而不是 INSERT OR REPLACE。后者在 SQLite 里是
        // 「先 DELETE 再 INSERT」,而默认 recursive_triggers=off 时那次隐式
        // DELETE **不触发** messages_fts_ad —— 每次重新落同一条消息(翻历史、
        // 回应、编辑)都会在外置内容的 FTS 影子表里留下一行孤儿,而 500 条的
        // 保留上限管不到它们。
        await current.db.runAsync(
          `INSERT INTO messages
             (id, conversation_id, height, created_at, type, text, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             conversation_id = excluded.conversation_id,
             height = excluded.height,
             created_at = excluded.created_at,
             type = excluded.type,
             text = excluded.text,
             payload = excluded.payload;`,
          message.id,
          conversationId,
          message.height,
          message.createdAt,
          message.type,
          searchableTextOf(message),
          JSON.stringify(message),
        );
      }
      const bounds = await current.db.getFirstAsync<{
        lo: number | null;
        hi: number | null;
      }>(
        'SELECT MIN(height) AS lo, MAX(height) AS hi FROM messages WHERE conversation_id = ?;',
        conversationId,
      );
      if (bounds?.hi != null && bounds.lo != null) {
        await current.db.runAsync(
          `INSERT INTO sync_state (conversation_id, min_height, max_height)
             VALUES (?, ?, ?)
           ON CONFLICT(conversation_id) DO UPDATE SET
             min_height = MIN(min_height, excluded.min_height),
             max_height = MAX(max_height, excluded.max_height);`,
          conversationId,
          bounds.lo,
          bounds.hi,
        );
      }
      // 保留上限:删最旧的多余行(REST 翻页仍可回看更早历史)。
      await current.db.runAsync(
        `DELETE FROM messages WHERE conversation_id = ? AND id IN (
           SELECT id FROM messages WHERE conversation_id = ?
           ORDER BY height DESC LIMIT -1 OFFSET ?
         );`,
        conversationId,
        conversationId,
        RETENTION_PER_CONVERSATION,
      );
    });
  } catch (error) {
    warn('msg-write', '[chat-db] persist messages failed', error);
  }
}

export async function deleteLocalMessage(
  conversationId: string,
  messageId: string,
): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeStatement(() =>
      current.db.runAsync(
        'DELETE FROM messages WHERE conversation_id = ? AND id = ?;',
        conversationId,
        messageId,
      ),
    );
  } catch (error) {
    warn('msg-delete', '[chat-db] delete message failed', error);
  }
}

/** 清空会话(G-14 本地半):消息与同步区间一并清,会话行由调用方回写。 */
export async function clearLocalConversationMessages(
  conversationId: string,
): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeTransaction(current.db, async () => {
      await current.db.runAsync(
        'DELETE FROM messages WHERE conversation_id = ?;',
        conversationId,
      );
      // outbox 里那些没发出去/发失败的消息也要一起删。
      //
      // 只删 messages 的话:那条私信正文原样留在库里,而且下次冷启动
      // hydrateFromLocalDb 会把它当「发送失败」气泡还原出来 —— 用户刚清空的
      // 会话里凭空多出一条他以为已经删掉的消息,清空既没清干净也没清住。
      await current.db.runAsync(
        'DELETE FROM outbox WHERE conversation_id = ?;',
        conversationId,
      );
      await current.db.runAsync(
        'DELETE FROM sync_state WHERE conversation_id = ?;',
        conversationId,
      );
    });
  } catch (error) {
    warn('msg-clear', '[chat-db] clear conversation failed', error);
  }
}

/**
 * 焚毁到期的本地清理。
 *
 * 服务端 sweeper 把过期消息物删了,但本地缓存不会自己知道:没有到期元数据、
 * 没有删除事件,后续 REST 页「少了哪些行」也无从对账。于是
 * readRecentLocalMessages 和 FTS 搜索仍然能把「本该烧掉」的正文端出来,
 * 冷启动之后更是原样恢复 —— 阅后即焚在本地这一侧等于没生效。
 *
 * 这里按会话的焚毁时长直接删本地行(DELETE 会触发 messages_fts_ad,
 * FTS 影子表跟着一起清)。判据用消息自己的 createdAt,与服务端 sweeper
 * 和读路径过滤同一把尺子。
 */
export interface ExpiredLocalMessagePurge {
  conversationId: string;
  cutoff: Date;
}

export async function purgeExpiredLocalMessages(
  entries: readonly ExpiredLocalMessagePurge[],
  viewerCutoff?: Date,
): Promise<void> {
  const current = requireDb();
  if (!current || (entries.length === 0 && !viewerCutoff)) return;
  try {
    await writeTransaction(current.db, async () => {
      if (viewerCutoff) {
        const cutoffIso = viewerCutoff.toISOString();
        // 全局查看者策略必须覆盖没有会话行的残留 rows，避免 FTS 继续检索正文。
        await current.db.runAsync(
          'DELETE FROM messages WHERE created_at < ?;',
          cutoffIso,
        );
        await current.db.runAsync(
          'DELETE FROM outbox WHERE created_at < ?;',
          cutoffIso,
        );
      }
      for (const { conversationId, cutoff } of entries) {
        if (viewerCutoff && cutoff <= viewerCutoff) continue;
        const cutoffIso = cutoff.toISOString();
        // 删除 messages 会触发 messages_fts_ad，FTS 影子表随同事务更新。
        await current.db.runAsync(
          'DELETE FROM messages WHERE conversation_id = ? AND created_at < ?;',
          conversationId,
          cutoffIso,
        );
        // 失败发送的正文同样是本地聊天内容；不删会在下次水合时重新出现。
        await current.db.runAsync(
          'DELETE FROM outbox WHERE conversation_id = ? AND created_at < ?;',
          conversationId,
          cutoffIso,
        );
      }
    });
  } catch (error) {
    warn('msg-burn', '[chat-db] purge expired messages failed', error);
  }
}

/**
 * 丢掉全部缓存消息,保留会话行与 outbox。
 *
 * 服务端说增量游标已超出保留窗口(resetRequired)时用:那段区间里发生的撤回
 * 服务端已经查不到了,而撤回不改 height —— 本地缓存里那些消息会永远显示原文。
 * 唯一安全的做法是让它们重新从服务端拉一遍(会话行留着,列表不至于空掉)。
 */
export async function dropAllLocalMessages(): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeTransaction(current.db, async () => {
      await current.db.runAsync('DELETE FROM messages;');
      await current.db.runAsync('DELETE FROM sync_state;');
    });
  } catch (error) {
    warn('msg-drop', '[chat-db] drop all messages failed', error);
  }
}

/** 中洞修剪(冷启动本地块与最新 REST 页之间隔了 >N 条时,放弃旧块保连续性)。 */
export async function deleteLocalMessagesBelow(
  conversationId: string,
  height: number,
): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeTransaction(current.db, async () => {
      await current.db.runAsync(
        'DELETE FROM messages WHERE conversation_id = ? AND height < ?;',
        conversationId,
        height,
      );
      await current.db.runAsync(
        'UPDATE sync_state SET min_height = MAX(min_height, ?) WHERE conversation_id = ?;',
        height,
        conversationId,
      );
    });
  } catch (error) {
    warn('msg-prune', '[chat-db] prune below failed', error);
  }
}

export async function readRecentLocalMessages(
  conversationId: string,
  limit: number,
): Promise<ChatMessageDto[]> {
  const current = requireDb();
  if (!current) return [];
  try {
    const rows = await current.db.getAllAsync<{ payload: string }>(
      'SELECT payload FROM messages WHERE conversation_id = ? ORDER BY height DESC LIMIT ?;',
      conversationId,
      limit,
    );
    const parsed: ChatMessageDto[] = [];
    for (const row of rows) {
      try {
        parsed.push(JSON.parse(row.payload) as ChatMessageDto);
      } catch {
        // skip
      }
    }
    return parsed.reverse();
  } catch (error) {
    warn('msg-read', '[chat-db] read messages failed', error);
    return [];
  }
}

export async function getLocalSyncState(
  conversationId: string,
): Promise<{ minHeight: number; maxHeight: number } | null> {
  const current = requireDb();
  if (!current) return null;
  try {
    const row = await current.db.getFirstAsync<{
      min_height: number;
      max_height: number;
    }>(
      'SELECT min_height, max_height FROM sync_state WHERE conversation_id = ?;',
      conversationId,
    );
    return row
      ? { minHeight: row.min_height, maxHeight: row.max_height }
      : null;
  } catch {
    return null;
  }
}

/** FTS5 的查询串转义:整体按短语匹配,避免用户输入撞上 FTS 语法。 */
function ftsPhrase(keyword: string): string {
  return `"${keyword.replaceAll('"', '""')}"`;
}

/** 本地全文搜索(G-03):FTS5 优先,不可用回退 LIKE;结果最新在前。 */
export async function searchLocalChatMessages(
  keyword: string,
  limit: number,
): Promise<ChatMessageDto[]> {
  const current = requireDb();
  const trimmed = keyword.trim();
  if (!current || trimmed.length === 0) return [];
  try {
    const rows = current.ftsAvailable
      ? await current.db.getAllAsync<{ payload: string }>(
          `SELECT m.payload AS payload
             FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
            WHERE messages_fts MATCH ?
            ORDER BY m.created_at DESC LIMIT ?;`,
          ftsPhrase(trimmed),
          limit,
        )
      : await current.db.getAllAsync<{ payload: string }>(
          `SELECT payload FROM messages
            WHERE text LIKE ? ESCAPE '\\'
            ORDER BY created_at DESC LIMIT ?;`,
          `%${trimmed.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
          limit,
        );
    const parsed: ChatMessageDto[] = [];
    for (const row of rows) {
      try {
        parsed.push(JSON.parse(row.payload) as ChatMessageDto);
      } catch {
        // skip
      }
    }
    return parsed;
  } catch (error) {
    warn('search', '[chat-db] local search failed', error);
    return [];
  }
}

// ---- outbox(发送失败/待发消息,App 被杀不丢) ----

export interface OutboxEntry {
  d: string;
  conversationId: string;
  payload: {
    conversationId: string;
    type: string;
    content: Record<string, unknown>;
    d: string;
    replyToId?: string;
    forwardFromMessageId?: string;
    /** 仅供本地失败气泡恢复；重发前必须从 websocket 载荷剥离。 */
    localPreviewContent?: Record<string, unknown>;
  };
  createdAt: string;
  /** 点击发送时的服务端消息水位，用于失败气泡重启后的稳定定位。 */
  failedAfterHeight?: number;
}

export async function outboxUpsert(entry: OutboxEntry): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeStatement(() =>
      current.db.runAsync(
        'INSERT OR REPLACE INTO outbox (d, conversation_id, payload, created_at, failed_after_height) VALUES (?, ?, ?, ?, ?);',
        entry.d,
        entry.conversationId,
        JSON.stringify(entry.payload),
        entry.createdAt,
        entry.failedAfterHeight ?? null,
      ),
    );
  } catch (error) {
    warn('outbox-write', '[chat-db] outbox upsert failed', error);
  }
}

export async function outboxDelete(d: string): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeStatement(() =>
      current.db.runAsync('DELETE FROM outbox WHERE d = ?;', d),
    );
  } catch (error) {
    warn('outbox-delete', '[chat-db] outbox delete failed', error);
  }
}

export async function outboxList(): Promise<OutboxEntry[]> {
  const current = requireDb();
  if (!current) return [];
  try {
    const rows = await current.db.getAllAsync<{
      d: string;
      conversation_id: string;
      payload: string;
      created_at: string;
      failed_after_height: number | null;
    }>(
      'SELECT d, conversation_id, payload, created_at, failed_after_height FROM outbox ORDER BY created_at ASC;',
    );
    const parsed: OutboxEntry[] = [];
    for (const row of rows) {
      try {
        parsed.push({
          d: row.d,
          conversationId: row.conversation_id,
          payload: JSON.parse(row.payload) as OutboxEntry['payload'],
          createdAt: row.created_at,
          ...(Number.isFinite(row.failed_after_height)
            ? { failedAfterHeight: row.failed_after_height ?? 0 }
            : {}),
        });
      } catch {
        // skip
      }
    }
    return parsed;
  } catch (error) {
    warn('outbox-read', '[chat-db] outbox read failed', error);
    return [];
  }
}

// ---- pending reads(已读水位待上报队列,App 被杀不丢) ----

export async function pendingReadUpsert(
  conversationId: string,
  height: number,
): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeStatement(() =>
      current.db.runAsync(
        `INSERT INTO pending_reads (conversation_id, height) VALUES (?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         height = MAX(height, excluded.height);`,
        conversationId,
        height,
      ),
    );
  } catch (error) {
    warn('read-write', '[chat-db] pending read upsert failed', error);
  }
}

export async function pendingReadDelete(conversationId: string): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeStatement(() =>
      current.db.runAsync(
        'DELETE FROM pending_reads WHERE conversation_id = ?;',
        conversationId,
      ),
    );
  } catch (error) {
    warn('read-delete', '[chat-db] pending read delete failed', error);
  }
}

export async function pendingReadsList(): Promise<
  { conversationId: string; height: number }[]
> {
  const current = requireDb();
  if (!current) return [];
  try {
    const rows = await current.db.getAllAsync<{
      conversation_id: string;
      height: number;
    }>('SELECT conversation_id, height FROM pending_reads;');
    return rows.map((row) => ({
      conversationId: row.conversation_id,
      height: row.height,
    }));
  } catch (error) {
    warn('read-read', '[chat-db] pending reads read failed', error);
    return [];
  }
}

/** 设置页「清空全部聊天」:整库清表(保留 outbox 之外的一切都可从服务端重建)。 */
export async function wipeChatLocalDb(): Promise<void> {
  const current = requireDb();
  if (!current) return;
  try {
    await writeStatement(() =>
      current.db.execAsync(`
      DELETE FROM conversations;
      DELETE FROM messages;
      DELETE FROM sync_state;
      DELETE FROM pending_reads;
      DELETE FROM outbox;
    `),
    );
  } catch (error) {
    warn('wipe', '[chat-db] wipe failed', error);
  }
}
