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
const SCHEMA_VERSION = 3;

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
  // v3 会话变更序号流:消息行记它的 revision(旧快照不能盖掉新状态),
  // sync_state 记每个会话已经追平到的 revision(增量同步游标)。
  const messageColumns = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(messages);',
  );
  if (!messageColumns.some((column) => column.name === 'revision')) {
    await db.execAsync(
      'ALTER TABLE messages ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;',
    );
  }
  const syncColumns = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(sync_state);',
  );
  if (!syncColumns.some((column) => column.name === 'revision')) {
    await db.execAsync(
      'ALTER TABLE sync_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;',
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
 * 单条消息 upsert(调用方负责事务)。
 *
 * ON CONFLICT DO UPDATE 而不是 INSERT OR REPLACE。后者在 SQLite 里是「先 DELETE
 * 再 INSERT」,而默认 recursive_triggers=off 时那次隐式 DELETE **不触发**
 * messages_fts_ad —— 每次重新落同一条消息(翻历史、回应、编辑)都会在外置内容的
 * FTS 影子表里留下一行孤儿,而 500 条的保留上限管不到它们。
 *
 * WHERE excluded.revision >= messages.revision:一页较早发出的历史/补拉比实时事件
 * 晚落地时,它带的是旧版本,不能把撤回/编辑/回应盖回去。没有 revision 的(老后端、
 * 本地合成的确认)按 0 处理,只能覆盖同样没有 revision 的行。
 */
async function upsertMessageRow(
  db: SQLite.SQLiteDatabase,
  conversationId: string,
  message: ChatMessageDto,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO messages
       (id, conversation_id, height, created_at, type, text, payload, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       conversation_id = excluded.conversation_id,
       height = excluded.height,
       created_at = excluded.created_at,
       type = excluded.type,
       text = excluded.text,
       payload = excluded.payload,
       revision = excluded.revision
     WHERE excluded.revision >= messages.revision;`,
    message.id,
    conversationId,
    message.height,
    message.createdAt,
    message.type,
    searchableTextOf(message),
    JSON.stringify(message),
    typeof message.revision === 'number' ? message.revision : 0,
  );
}

/** 只更新本地已经缓存着的那一行(revision 不后退);不存在就什么都不做。 */
async function updateCachedMessageRow(
  db: SQLite.SQLiteDatabase,
  conversationId: string,
  message: ChatMessageDto,
): Promise<void> {
  const revision = typeof message.revision === 'number' ? message.revision : 0;
  await db.runAsync(
    `UPDATE messages SET
       height = ?, created_at = ?, type = ?, text = ?, payload = ?, revision = ?
     WHERE id = ? AND conversation_id = ? AND revision <= ?;`,
    message.height,
    message.createdAt,
    message.type,
    searchableTextOf(message),
    JSON.stringify(message),
    revision,
    message.id,
    conversationId,
    revision,
  );
}

/** 每会话保留上限:删最旧的多余行(REST 翻页仍可回看更早历史)。 */
async function trimConversationRetention(
  db: SQLite.SQLiteDatabase,
  conversationId: string,
): Promise<void> {
  await db.runAsync(
    `DELETE FROM messages WHERE conversation_id = ? AND id IN (
       SELECT id FROM messages WHERE conversation_id = ?
       ORDER BY height DESC LIMIT -1 OFFSET ?
     );`,
    conversationId,
    conversationId,
    RETENTION_PER_CONVERSATION,
  );
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
        await upsertMessageRow(current.db, conversationId, message);
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
      await trimConversationRetention(current.db, conversationId);
    });
  } catch (error) {
    warn('msg-write', '[chat-db] persist messages failed', error);
  }
}

// ---- 会话变更序号流(增量同步游标) ----

export interface LocalSyncState {
  /** 已经追平(连同对应消息一起落了盘)的 revision。 */
  revision: number;
  /** 本地库里有没有这个会话的消息(没有就不必对账,直接采纳服务端位置)。 */
  hasMessages: boolean;
}

/**
 * 全部会话的同步游标。null = 本地库不可用(调用方退回纯内存游标)。
 * 一次查询读完:重连时要对几十个会话逐个判断,逐个查就是几十次原生往返。
 */
export async function readLocalSyncStates(): Promise<Map<
  string,
  LocalSyncState
> | null> {
  const current = requireDb();
  if (!current) return null;
  try {
    const rows = await current.db.getAllAsync<{
      conversation_id: string;
      revision: number | null;
      has_messages: number;
    }>(
      `SELECT s.conversation_id AS conversation_id,
              s.revision AS revision,
              EXISTS (
                SELECT 1 FROM messages m WHERE m.conversation_id = s.conversation_id
              ) AS has_messages
         FROM sync_state s;`,
    );
    return new Map(
      rows.map((row) => [
        row.conversation_id,
        {
          revision: Number.isSafeInteger(row.revision) ? (row.revision as number) : 0,
          hasMessages: Boolean(row.has_messages),
        },
      ]),
    );
  } catch (error) {
    warn('sync-read', '[chat-db] read sync states failed', error);
    return null;
  }
}

async function upsertSyncRevision(
  db: SQLite.SQLiteDatabase,
  conversationId: string,
  revision: number,
  force: boolean,
): Promise<void> {
  await db.runAsync(
    force
      ? `INSERT INTO sync_state (conversation_id, min_height, max_height, revision)
           VALUES (?, 0, 0, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET revision = excluded.revision;`
      : `INSERT INTO sync_state (conversation_id, min_height, max_height, revision)
           VALUES (?, 0, 0, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           revision = MAX(revision, excluded.revision);`,
    conversationId,
    revision,
  );
}

/**
 * 实时事件推进的游标落盘(只前进)。消息本身已经由 ingest 入库;这里只记位置。
 * 返回是否写成功(本地库不可用时为 false)。
 */
export async function writeLocalSyncRevision(
  conversationId: string,
  revision: number,
): Promise<boolean> {
  const current = requireDb();
  if (!current) return false;
  try {
    await writeStatement(() =>
      upsertSyncRevision(current.db, conversationId, revision, false),
    );
    return true;
  } catch (error) {
    warn('sync-write', '[chat-db] write sync revision failed', error);
    return false;
  }
}

export interface LocalSyncPage {
  /** 当前状态的消息(含已撤回);按 revision 守卫 upsert。 */
  upserts: ChatMessageDto[];
  /** 焚毁墓碑:本地副本直接删。 */
  deletedIds: string[];
  /** 本人视角的清空水位:水位之下的本地行删掉。 */
  clearedBeforeHeight: number;
  /** 这一页之后的游标。 */
  revision: number;
}

/**
 * 一页增量同步原子落盘:消息、墓碑、清空水位、游标在同一个事务里。
 *
 * 游标必须和它覆盖的那些变更一起提交 —— 分开写的话,消息写失败而游标写成功,
 * 那段变更此后再也不会被同步到(游标已经越过去了)。返回 false = 本地库不可用
 * 或事务失败,调用方不能把这一页当成已经持久化。
 */
export async function applyLocalSyncPage(
  conversationId: string,
  page: LocalSyncPage,
): Promise<boolean> {
  const current = requireDb();
  if (!current) return false;
  try {
    await writeTransaction(current.db, async () => {
      // 本地缓存是每个会话「最新一段连续历史」:缓存里已有的行按 revision 守卫更新,
      // 比缓存最高 height 还新的追加;缓存之外的老消息(很早以前那条被撤回/编辑了)
      // 不插,插进来就是一块断层,冷启动水合会把它和最新那段拼在一起。
      const head = await current.db.getFirstAsync<{ hi: number | null }>(
        'SELECT MAX(height) AS hi FROM messages WHERE conversation_id = ?;',
        conversationId,
      );
      const cachedHead = head?.hi ?? 0;
      for (const message of page.upserts) {
        if (message.height <= 0) continue;
        if (cachedHead > 0 && message.height > cachedHead) {
          await upsertMessageRow(current.db, conversationId, message);
        } else {
          await updateCachedMessageRow(current.db, conversationId, message);
        }
      }
      if (page.deletedIds.length > 0) {
        const placeholders = page.deletedIds.map(() => '?').join(', ');
        await current.db.runAsync(
          `DELETE FROM messages WHERE conversation_id = ? AND id IN (${placeholders});`,
          conversationId,
          ...page.deletedIds,
        );
      }
      if (page.clearedBeforeHeight > 0) {
        await current.db.runAsync(
          'DELETE FROM messages WHERE conversation_id = ? AND height <= ?;',
          conversationId,
          page.clearedBeforeHeight,
        );
      }
      await trimConversationRetention(current.db, conversationId);
      await upsertSyncRevision(current.db, conversationId, page.revision, false);
    });
    return true;
  } catch (error) {
    warn('sync-apply', '[chat-db] apply sync page failed', error);
    return false;
  }
}

/**
 * 丢掉一个会话的消息缓存,并把游标直接设到 revision(落后太多跳到最新、或服务端
 * 要求 reset 时)。outbox 不动:没发出去的消息不属于服务端缓存。
 */
export async function resetLocalConversationCache(
  conversationId: string,
  revision: number,
): Promise<boolean> {
  const current = requireDb();
  if (!current) return false;
  try {
    await writeTransaction(current.db, async () => {
      await current.db.runAsync(
        'DELETE FROM messages WHERE conversation_id = ?;',
        conversationId,
      );
      await current.db.runAsync(
        'UPDATE sync_state SET min_height = 0, max_height = 0 WHERE conversation_id = ?;',
        conversationId,
      );
      await upsertSyncRevision(current.db, conversationId, revision, true);
    });
    return true;
  } catch (error) {
    warn('sync-reset', '[chat-db] reset conversation cache failed', error);
    return false;
  }
}

/**
 * 被引用的原消息撤回/焚毁之后,本地缓存里引用它的那些消息也要脱敏:引用快照
 * (预览文字)与兜底的 quotedText 都带着原文,不改的话会话里、本地搜索里都还能看到。
 *
 * - revoked:与服务端历史页同形 —— replyTo.revoked=true、preview 清空;
 * - gone(焚毁):服务端不再给快照 —— 整个 replyTo 去掉。
 *
 * 返回「本地已经没有引用原文了」:调用方(增量同步)据此决定要不要提交游标 ——
 * 游标一旦越过这一段就不会再追,脱敏没做成就等于永远留着。
 *
 * 脱敏语句依赖 JSON1(个别老构建没有);那时退而删掉整行,见 dropQuotingRows。
 */
export async function redactLocalQuotesOf(
  conversationId: string,
  targetIds: readonly string[],
  mode: 'revoked' | 'gone',
): Promise<boolean> {
  const current = requireDb();
  const ids = [...new Set(targetIds)].filter((id) => id.length > 0);
  // 本地库没开(Web / 没有 SQLCipher)时本机根本没有副本,没东西要脱敏。
  if (!current || ids.length === 0) return true;
  const placeholders = ids.map(() => '?').join(', ');
  const nextPayload =
    mode === 'revoked'
      ? `json_set(payload, '$.replyTo.revoked', json('true'), '$.replyTo.preview', '', '$.content.quotedText', '')`
      : `json_set(json_remove(payload, '$.replyTo'), '$.content.quotedText', '')`;
  try {
    await writeStatement(() =>
      current.db.runAsync(
        `UPDATE messages
            SET payload = ${nextPayload},
                text = CASE WHEN type IN ('text', 'quote')
                  THEN NULLIF(COALESCE(json_extract(payload, '$.content.text'), ''), '')
                  ELSE text END
          WHERE conversation_id = ?
            AND (json_extract(payload, '$.replyTo.id') IN (${placeholders})
                 OR json_extract(payload, '$.replyToId') IN (${placeholders}));`,
        conversationId,
        ...ids,
        ...ids,
      ),
    );
    return true;
  } catch (error) {
    warn('quote-redact', '[chat-db] redact quoting messages failed', error);
    return dropQuotingRows(current, conversationId, ids);
  }
}

/** LIKE 的通配符(% _)和转义符本身要转义,否则 id 里的下划线会误伤别的行。 */
function escapeLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * 脱敏语句跑不了(没有 JSON1)时的兜底:把引用了这些消息的行整行删掉。
 * 本地缓存少一行只是下次翻到时重新从服务端拉(拿回来的已经是脱敏后的),
 * 而引用里的原文一定不会留在设备上。
 */
async function dropQuotingRows(
  current: DbHandle,
  conversationId: string,
  ids: readonly string[],
): Promise<boolean> {
  const conditions = ids.map(() => "payload LIKE ? ESCAPE '\\'").join(' OR ');
  try {
    await writeStatement(() =>
      current.db.runAsync(
        `DELETE FROM messages WHERE conversation_id = ? AND (${conditions});`,
        conversationId,
        ...ids.map(escapeLikePattern),
      ),
    );
    return true;
  } catch (error) {
    warn('quote-redact', '[chat-db] drop quoting rows failed', error);
    return false;
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

/** 删除服务端已确认焚毁的消息，供实时 chat:burned_messages 收敛本地缓存。 */
export async function deleteLocalMessages(
  conversationId: string,
  messageIds: readonly string[],
  // 本机记下的焚毁开启时刻（ISO）。给了就只删这一刻及之后创建的行：服务端焚毁不看
  // 开启时间，开启前的历史按 App 的承诺保留（与 purgeExpiredLocalMessages 的
  // startedAt 下界同一口径）。
  options?: { createdAtNotBefore?: string | null },
): Promise<void> {
  const current = requireDb();
  const ids = [...new Set(messageIds)].filter(
    (messageId): messageId is string =>
      typeof messageId === 'string' && messageId.length > 0,
  );
  if (!current || ids.length === 0) return;
  try {
    await writeTransaction(current.db, async () => {
      const placeholders = ids.map(() => '?').join(', ');
      const boundary = options?.createdAtNotBefore || null;
      const boundaryClause = boundary ? ' AND created_at >= ?' : '';
      await current.db.runAsync(
        `DELETE FROM messages WHERE conversation_id = ? AND id IN (${placeholders})${boundaryClause};`,
        conversationId,
        ...ids,
        ...(boundary ? [boundary] : []),
      );
    });
  } catch (error) {
    warn('msg-burn-delete', '[chat-db] delete burned messages failed', error);
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
  startedAt?: Date;
}

export async function purgeExpiredLocalMessages(
  entries: readonly ExpiredLocalMessagePurge[],
  viewerCutoff?: Date,
  viewerStartedAt?: Date,
): Promise<void> {
  const current = requireDb();
  if (!current || (entries.length === 0 && !viewerCutoff)) return;
  try {
    await writeTransaction(current.db, async () => {
      if (viewerCutoff && viewerStartedAt) {
        const cutoffIso = viewerCutoff.toISOString();
        const startedIso = viewerStartedAt.toISOString();
        // 全局查看者策略必须覆盖没有会话行的残留 rows，避免 FTS 继续检索正文。
        await current.db.runAsync(
          'DELETE FROM messages WHERE created_at >= ? AND created_at < ?;',
          startedIso,
          cutoffIso,
        );
        await current.db.runAsync(
          'DELETE FROM outbox WHERE created_at >= ? AND created_at < ?;',
          startedIso,
          cutoffIso,
        );
      }
      for (const { conversationId, cutoff, startedAt } of entries) {
        if (!startedAt) continue;
        const cutoffIso = cutoff.toISOString();
        const startedIso = startedAt.toISOString();
        // 删除 messages 会触发 messages_fts_ad，FTS 影子表随同事务更新。
        await current.db.runAsync(
          'DELETE FROM messages WHERE conversation_id = ? AND created_at >= ? AND created_at < ?;',
          conversationId,
          startedIso,
          cutoffIso,
        );
        // 失败发送的正文同样是本地聊天内容；不删会在下次水合时重新出现。
        await current.db.runAsync(
          'DELETE FROM outbox WHERE conversation_id = ? AND created_at >= ? AND created_at < ?;',
          conversationId,
          startedIso,
          cutoffIso,
        );
      }
    });
  } catch (error) {
    warn('msg-burn', '[chat-db] purge expired messages failed', error);
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

/** outbox 里还没上传完的媒体(见 chat-core/pending-media)。 */
export interface PendingMediaRecord {
  type: 'image' | 'video' | 'voice';
  /** 持久目录里的文件名(不存绝对路径:容器路径每次启动都可能变)。 */
  fileName: string;
  /** 上传时用的原始文件名与类型(presign 需要)。 */
  uploadName: string;
  contentType: string;
  width?: number;
  height?: number;
  /** 秒。 */
  duration?: number;
  size?: number;
}

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
    /**
     * 还没发出去的媒体:源文件已经拷进持久目录(chat-core/pending-media)。
     * content 里还没有 object key 时,重启后长按重发要从副本重新上传;有 key 之后
     * 仍保留,冷启动还原失败气泡时靠它找回本地预览。只在本地用,不上行。
     */
    pendingMedia?: PendingMediaRecord;
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
  return (await readOutboxEntries()) ?? [];
}

/**
 * 同 outboxList,但读不到(库没开、查询失败)时返回 null 而不是空数组。
 * 拿结果去删东西的调用方(冷启动清待发媒体副本)必须分清「outbox 是空的」和
 * 「outbox 读不出来」—— 后者当成前者会把所有还没发出去的照片/录音一起删掉。
 */
export async function readOutboxEntries(): Promise<OutboxEntry[] | null> {
  const current = requireDb();
  if (!current) return null;
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
    return null;
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
