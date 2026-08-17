import { assertLocalCanSendMessage } from '@/services/api/credit-policy';
import { useAuthStore } from '@/stores/authStore';
import {
  createCircleChatConversation,
  createDirectChatConversation,
  createGroupChatConversation,
  loadChatHistory,
} from './api';
import { reportChatSendFailure } from './send-errors';
import {
  ChatSendError,
  createDeliveryId,
  markConversationRead,
  sendChatMessage,
} from './socket-manager';
import { useChatStore, type StoredChatMessage } from './store';
import { type ChatMessageDto } from './protocol';
import { outboxDelete, outboxList, outboxUpsert } from './local-db';

/**
 * 聊天页面向的高层 API(对齐旧 src/im/client 的调用形态,屏幕换 import 即用)。
 * 发送 = 乐观回显 → socket ack(已持久化)→ 同 d 替换;失败标记失败态。
 */

export interface EnsuredConversation {
  conversationID: string;
}

/** 取或建单聊(个人资料「发消息」等入口)。 */
export async function ensureDirectConversation(
  peerUserId: string,
): Promise<EnsuredConversation> {
  const epoch = useAuthStore.getState().sessionEpoch;
  const dto = await createDirectChatConversation(peerUserId);
  // 切号后落地的在途响应不写进新账号的 store。
  if (useAuthStore.getState().sessionEpoch === epoch) {
    useChatStore.getState().upsertConversation(dto);
  }
  return { conversationID: dto.id };
}

/** 取或建圈子群聊(圈子详情/列表入口;进圈后首次调用触发座位同步)。 */
export async function ensureCircleConversation(
  circleId: string,
): Promise<EnsuredConversation> {
  const epoch = useAuthStore.getState().sessionEpoch;
  const dto = await createCircleChatConversation(circleId);
  if (useAuthStore.getState().sessionEpoch === epoch) {
    useChatStore.getState().upsertConversation(dto);
  }
  return { conversationID: dto.id };
}

/** 创建独立群聊并写入会话缓存(建群页提交入口)。 */
export async function createGroupConversation(input: {
  name?: string | null;
  memberIds: string[];
}): Promise<EnsuredConversation> {
  const epoch = useAuthStore.getState().sessionEpoch;
  const dto = await createGroupChatConversation(input);
  if (useAuthStore.getState().sessionEpoch === epoch) {
    useChatStore.getState().upsertConversation(dto);
  }
  return { conversationID: dto.id };
}

/**
 * 历史翻页游标:会话 id → 下一页的 beforeHeight。
 * null = 已到头(没有更早的了);缺键 = 还没拉过首页。
 * 原来首页的 nextBeforeHeight 被直接丢掉,超过一页的会话就再也翻不到
 * 更早的消息,搜索也跳不到首页之外的目标。
 */
const historyCursors = new Map<string, number | null>();
/** 同一会话的翻页请求串行化,避免连续触底打出重复的一页。 */
const inFlightPages = new Map<string, Promise<void>>();

/** 进入会话时的历史拉取(最新一页),并记下继续向前翻的游标。 */
export async function loadConversationMessages(
  conversationId: string,
): Promise<void> {
  const page = await loadChatHistory(conversationId);
  historyCursors.set(conversationId, page.nextBeforeHeight);
}

/** 是否还有更早的消息可翻(UI 据此决定是否显示加载指示)。 */
export function hasMoreHistory(conversationId: string): boolean {
  return historyCursors.get(conversationId) != null;
}

/**
 * 继续向前翻一页(inverted 列表触底时调用)。
 * 已到头 / 首页还没拉 / 同会话已有在途请求时都是安全的 no-op。
 */
export function loadOlderConversationMessages(
  conversationId: string,
): Promise<void> {
  const cursor = historyCursors.get(conversationId);
  if (cursor == null) return Promise.resolve();
  const inFlight = inFlightPages.get(conversationId);
  if (inFlight) return inFlight;
  const request = loadChatHistory(conversationId, { beforeHeight: cursor })
    .then((page) => {
      historyCursors.set(conversationId, page.nextBeforeHeight);
    })
    .finally(() => {
      inFlightPages.delete(conversationId);
    });
  inFlightPages.set(conversationId, request);
  return request;
}

/** 退出会话 / 登出时丢掉游标,下次进入重新从最新一页开始。 */
export function resetHistoryCursor(conversationId?: string): void {
  if (conversationId === undefined) {
    historyCursors.clear();
    inFlightPages.clear();
    return;
  }
  historyCursors.delete(conversationId);
  inFlightPages.delete(conversationId);
}

/** 已读:以本地已知的最大 height 上报水位 + 本地未读归零。 */
export function markConversationAsRead(conversationId: string): void {
  const state = useChatStore.getState();
  const messages = state.messagesByConversation[conversationId] ?? [];
  let height = 0;
  for (const message of messages) {
    if (message.height > height) height = message.height;
  }
  if (height === 0) {
    const conversation = state.conversations.find((c) => c.id === conversationId);
    height = conversation?.lastMessage?.height ?? 0;
  }
  markConversationRead(conversationId, height);
}

interface SendOptions {
  conversationId: string;
  type: string;
  /**
   * 复用一个已经上屏的乐观气泡的 d(媒体消息「先上屏、后上传」用)。
   * 省略时自己生成 —— 文本/卡片这些没有上传阶段的类型走这条。
   */
  deliveryId?: string;
  /** 线上载荷。媒体消息只放 object key,任何本地/展示用地址都不进这里。 */
  content: Record<string, unknown>;
  /**
   * 只叠加到本地乐观消息上、绝不上行的字段(发图/发语音的 localUri)。
   * 上行了的话它会被服务端原样持久化并广播给所有人,而收件方的映射层
   * 会把它当成可渲染地址 —— 对端就能借此投放一个静默追踪信标。
   */
  localContent?: Record<string, unknown>;
  replyToId?: string;
  /** 乐观消息上屏回调(旧 sendTextMessage onCreate 对应物)。 */
  onCreate?: (message: ChatMessageDto) => void;
}

function selfSenderInfo() {
  const user = useAuthStore.getState().user;
  return user
    ? { id: user.id, nickname: user.nickname ?? '', avatarUrl: user.avatarUrl ?? null }
    : null;
}

/**
 * 发送核心:乐观 DTO(height=0, id=local:{d})立即入库并联动会话列表;
 * ack 返回后以真 id/height 替换(store 按 d 对账);失败置失败态并抛出。
 * 断线重发语义:失败后重试应复用同一 d —— 服务端幂等约束保证不重复。
 */
export async function sendWithOptimism(
  options: SendOptions,
): Promise<ChatMessageDto> {
  // 信用分门禁:所有发送都从这里过,所以闸放在这一层才是完整的。
  // 拆栈前它挂在 reportSend 包装器上,迁移后只剩发图路径单独调了一次 ——
  // 于是低于阈值的用户仍然能正常发文本/引用/语音/位置/各类卡片。
  // 后端刻意不做这道校验(策略在端上),漏了就是真的漏了。
  // 抛在插入乐观消息之前:失败的发送不该在时间线里留下痕迹。
  //
  // 这里没有豁免口子。转账卡片曾经有一个(「钱已经动了、拦也白拦」),
  // 但那张卡现在由服务端结算后自己签发,客户端根本不经过这条路径。
  assertLocalCanSendMessage();
  const d = options.deliveryId ?? createDeliveryId();
  const store = useChatStore.getState();
  const optimistic: StoredChatMessage = {
    id: `local:${d}`,
    conversationId: options.conversationId,
    height: 0,
    type: options.type,
    content: options.localContent
      ? { ...options.content, ...options.localContent }
      : options.content,
    sender: selfSenderInfo(),
    replyToId: options.replyToId ?? null,
    d,
    createdAt: new Date().toISOString(),
  };
  store.ingestMessages(options.conversationId, [optimistic]);
  store.applyIncomingMessage(optimistic);
  options.onCreate?.(optimistic);

  // G-01 outbox:**先落盘再发送** —— App 在 ack 前被杀,重启后这条会以
  // 「发送失败」气泡还原(长按可重发,同 d 幂等);成功后出队。
  //
  // 这里必须 await。fire-and-forget 的话:connectChat 打开本地库也是异步的,
  // 用户一连上就发的那条消息会撞上 requireDb() === null 直接静默丢弃;
  // 或者原生写还挂着的时候进程被杀 —— 而「ack 前被杀」正是这个 outbox
  // 唯一要兜的场景。落盘失败不阻断发送(缓存是可选层),但要先等它有结果。
  //
  // 这里不再需要 SERVER_COMPENSATED_TYPES 的排除分支:回执类卡片已经完全不走
  // 客户端发送路径,能到这里的类型没有一个是服务端补发的。该常量仍在
  // socket-manager 的 outbox 回放里用于清理**旧版本客户端**留下的脏条目。
  await outboxUpsert({
    d,
    conversationId: options.conversationId,
    payload: {
      conversationId: options.conversationId,
      type: options.type,
      content: options.content,
      d,
      ...(options.replyToId ? { replyToId: options.replyToId } : {}),
    },
    createdAt: optimistic.createdAt,
  }).catch(() => undefined);
  try {
    const ack = await sendChatMessage({
      conversationId: options.conversationId,
      type: options.type,
      content: options.content,
      d,
      replyToId: options.replyToId,
    });
    void outboxDelete(d);
    const next = useChatStore.getState();
    // 服务端的 chat:msg 回声可能跑在 ack 前面。那条广播是权威版本(服务端
    // 规范化过的 content、服务端时间戳);下面这个 confirmed 只是拿本地乐观
    // 对象换了个 id/height 拼出来的合成品,还带着只该留在本机的 localUri。
    // mergeMessages 按 id 覆盖 —— 不让路的话权威那条会被合成品盖掉,
    // 时间线和会话预览一起退回客户端的时间与本地地址。
    const echoed = (
      next.messagesByConversation[options.conversationId] ?? []
    ).find((m) => m.id === ack.messageId);
    if (echoed) return echoed;

    const confirmed: ChatMessageDto = {
      ...optimistic,
      id: ack.messageId,
      height: ack.height,
    };
    next.ingestMessages(options.conversationId, [confirmed]);
    next.applyIncomingMessage(confirmed);
    return confirmed;
  } catch (error) {
    const failed = useChatStore.getState();
    failed.markMessageFailed(options.conversationId, d);
    // 乐观写入已经把会话预览换成了这条消息;发送失败后只标时间线是不够的,
    // 会话列表会一直把「服务端可能根本没有」的内容当作最新消息展示。
    failed.revertConversationPreview(options.conversationId);
    // 生产上报。拆栈前 reportSend 包装器会报每一次发送拒绝,迁移后这条最关键的
    // 链路只剩屏幕里 __DEV__ 的 console.warn —— release 包里 ack 超时和服务端
    // 持续拒绝没有任何信号,「全网发不出消息」和「某个用户网不好」长得一模一样。
    // 只带消息类型与白名单错误码,不带正文/d/conversationId(见 send-errors)。
    reportChatSendFailure(options.type, error);
    throw error;
  }
}

export function sendTextMessage(options: {
  conversationId: string;
  text: string;
  mentions?: { userId: string; nickname: string }[];
  atAll?: boolean;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: 'text',
    content: {
      text: options.text,
      ...(options.mentions?.length ? { mentions: options.mentions } : {}),
      ...(options.atAll ? { atAll: true } : {}),
    },
    onCreate: options.onCreate,
  });
}

export function sendQuoteMessage(options: {
  conversationId: string;
  text: string;
  quotedText: string;
  replyToId?: string;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: 'quote',
    content: { text: options.text, quotedText: options.quotedText },
    replyToId: options.replyToId,
    onCreate: options.onCreate,
  });
}

export function sendImageMessage(options: {
  conversationId: string;
  /** 上传后的 object key(经现有 /upload presign 流程),服务端读时签 URL。 */
  key: string;
  localUri?: string;
  width?: number;
  height?: number;
  thumbKey?: string;
  /** 见 SendOptions.deliveryId:接管上传前就已经上屏的那个气泡。 */
  deliveryId?: string;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    deliveryId: options.deliveryId,
    type: 'image',
    content: {
      key: options.key,
      ...(options.thumbKey ? { thumbKey: options.thumbKey } : {}),
      ...(options.width ? { width: options.width } : {}),
      ...(options.height ? { height: options.height } : {}),
    },
    // 本机文件 uri 只喂自己的气泡,不上行。
    localContent: options.localUri ? { localUri: options.localUri } : undefined,
    onCreate: options.onCreate,
  });
}

export function sendVideoMessage(options: {
  conversationId: string;
  key: string;
  localUri?: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  deliveryId?: string;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    deliveryId: options.deliveryId,
    type: 'video',
    content: {
      key: options.key,
      ...(options.width ? { width: options.width } : {}),
      ...(options.height ? { height: options.height } : {}),
      ...(options.duration ? { duration: options.duration } : {}),
      ...(options.size ? { size: options.size } : {}),
    },
    localContent: options.localUri ? { localUri: options.localUri } : undefined,
    onCreate: options.onCreate,
  });
}

export function sendVoiceMessage(options: {
  conversationId: string;
  key: string;
  duration: number;
  size?: number;
  localUri?: string;
  /** 见 SendOptions.deliveryId:接管上传前就已经上屏的那个气泡。 */
  deliveryId?: string;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    deliveryId: options.deliveryId,
    type: 'voice',
    content: {
      key: options.key,
      duration: options.duration,
      ...(options.size ? { size: options.size } : {}),
    },
    localContent: options.localUri ? { localUri: options.localUri } : undefined,
    onCreate: options.onCreate,
  });
}

export function sendLocationMessage(options: {
  conversationId: string;
  latitude: number;
  longitude: number;
  title?: string;
  address?: string;
  /** 旧客户端位置消息只有 description；保留入参以兼容转发历史消息。 */
  description?: string;
}): Promise<ChatMessageDto> {
  const description = options.address || options.description || options.title || '';
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: 'location',
    content: {
      latitude: options.latitude,
      longitude: options.longitude,
      ...(options.title ? { title: options.title } : {}),
      ...(options.address ? { address: options.address } : {}),
      description,
    },
  });
}

/**
 * 客户端可发的卡片类型。
 *
 * 这份枚举必须是后端 CLIENT_MESSAGE_TYPES 的子集 —— 由
 * test/transfer-card-server-issued.test.js 的跨仓契约断言看住。判据是「这条消息
 * 断言的事实,服务端能不能替它背书」:分享类卡片(笔记/名片/圈子/广场帖)只是个
 * 指针,收件人点开时自己去取真值,伪造顶多是发了条无效链接;而回执类卡片断言的是
 * **已经发生过的服务端事实**(钱已划走、身份已核验、通话已结束),客户端能发就
 * 等于能凭空捏造它。
 *
 * 所以 transfer-card / verification-card / call-record 一律由服务端签发,
 * 不出现在这里 —— 前两者原本在这里、且都 100% 被服务端拒收过。
 */
export type ChatCardType =
  | 'note-card'
  | 'friend-card'
  | 'circle-card'
  | 'plaza-post-card';

/** 各类卡片:content 即卡片 payload 本体(渲染侧同一形状,零转换)。 */
export function sendCardMessage(options: {
  conversationId: string;
  type: ChatCardType;
  /** 卡片 payload 本体(NoteCardData 等接口类型无索引签名,收 object 再收窄)。 */
  payload: object;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: options.type,
    content: options.payload as Record<string, unknown>,
    onCreate: options.onCreate,
  });
}


/**
 * 媒体消息(语音/图片/视频)的「先上屏、后上传」。
 *
 * 原来的顺序是 presign → 上传 → 才建乐观气泡:上传那段时间里屏幕上什么都没有,
 * 输入栏还被 inFlightRef 锁着(最长 60s 上传超时)—— 用户看到的是「录完就消失、
 * 再按没反应」,失败了那段录音也直接没了,连重发的入口都不存在。
 *
 * 现在录完/选完就先上屏一个 sendStatus=1 的气泡(content 里带 localUri,
 * 本机直接渲染),上传在后台跑;失败就把这个气泡标红,长按「重发」重跑整条
 * 「上传 + 发送」。
 *
 * 重试闭包只活在本次会话内存里:上传还没成功就意味着服务端没有这条消息,
 * outbox 那套(payload 里只有 object key)接不住它。App 重启后红气泡随内存
 * 一起消失 —— 比重启后留一个永远重发失败的按钮诚实。
 */
const mediaRetries = new Map<string, () => Promise<void>>();

export function startMediaSend(options: {
  conversationId: string;
  type: 'image' | 'video' | 'voice';
  /** 上屏用的本地内容:localUri / duration / width / height,不上行。 */
  localContent: Record<string, unknown>;
  /** 重跑整条上传+发送(拿到同一个 d,失败气泡才会被替换而不是又多一条)。 */
  retry: (deliveryId: string) => Promise<void>;
}): string {
  const d = createDeliveryId();
  const optimistic: StoredChatMessage = {
    id: `local:${d}`,
    conversationId: options.conversationId,
    height: 0,
    type: options.type,
    content: options.localContent,
    sender: selfSenderInfo(),
    replyToId: null,
    d,
    createdAt: new Date().toISOString(),
  };
  const store = useChatStore.getState();
  store.ingestMessages(options.conversationId, [optimistic]);
  store.applyIncomingMessage(optimistic);
  mediaRetries.set(d, () => options.retry(d));
  return d;
}

/** 上传或发送失败:气泡标红(长按可重发),会话预览退回上一条权威消息。 */
export function failMediaSend(conversationId: string, d: string): void {
  const store = useChatStore.getState();
  store.markMessageFailed(conversationId, d);
  store.revertConversationPreview(conversationId);
}

/** 发送成功:重试闭包连同它captured 的本地文件引用一起丢掉。 */
export function finishMediaSend(d: string): void {
  mediaRetries.delete(d);
}

/**
 * 正在重发的 deliveryId。
 *
 * 媒体重发要重跑整条「presign + 上传 + 发送」,可能几十秒。这期间气泡还红着、
 * mediaRetries 里的闭包也还在 —— 不挡住的话用户多按几下就是多跑几遍上传:
 * 重复取签名、把同一份原图和缩略图再传一遍,存储里留下没人引用的对象。
 * 复用同一个 d 只能让最后落库的那条聊天消息不重复,拦不住上传本身。
 */
const retriesInFlight = new Set<string>();

/**
 * G-01 重发:失败气泡长按「重发」。复用同一 d(服务端幂等兜底,绝不重复入库);
 * 成功后服务端回声(chat:msg 同 d)会替换掉失败的乐观气泡,outbox 出队。
 */
export async function retryFailedChatMessage(
  conversationId: string,
  d: string,
): Promise<void> {
  if (retriesInFlight.has(d)) return;
  retriesInFlight.add(d);
  // 气泡从红转回「发送中」(sendStatus 3→1):长按菜单里的「重发」只在
  // sendStatus===3 时出现,连点的入口本身就消失了,用户也看得出这一下生效了。
  useChatStore.getState().markMessageRetrying(conversationId, d);
  try {
    await runRetry(conversationId, d);
  } catch (error) {
    // 上面把失败态清掉了,这里必须补回来 —— 否则重发再失败,气泡会一直停在
    // 「发送中」,既没有红色提示也再没有重发入口。
    useChatStore.getState().markMessageFailed(conversationId, d);
    throw error;
  } finally {
    retriesInFlight.delete(d);
  }
}

async function runRetry(conversationId: string, d: string): Promise<void> {
  // 媒体消息优先:它压根没进过 outbox(那时候还没有 object key),
  // 重发要从上传重跑,不是把同一份 payload 再 emit 一次。
  // (媒体那条链路自己 catch 后调 failMediaSend,不抛到这里。)
  const media = mediaRetries.get(d);
  if (media) {
    await media();
    return;
  }
  const entries = await outboxList();
  const entry = entries.find(
    (item) => item.d === d && item.conversationId === conversationId,
  );
  if (!entry) throw new ChatSendError('CHAT_INVALID_PAYLOAD', '找不到待重发的消息');
  const ack = await sendChatMessage(entry.payload);
  void outboxDelete(d);
  // 原来只出队就完事了。可首次发送其实**已经在服务端落库**、只是 ack 和回声
  // 都丢了的情况下,重发命中幂等分支:服务端返回成功但刻意不再广播 chat:msg。
  // 没有回声就没有东西替换那个失败气泡 —— 消息明明发出去了,本地却永远红着。
  // ack 里有权威 id/height,照首发路径自己确认掉。
  const store = useChatStore.getState();
  const echoed = (store.messagesByConversation[conversationId] ?? []).find(
    (m) => m.id === ack.messageId,
  );
  if (echoed) return;
  const optimistic = (
    store.messagesByConversation[conversationId] ?? []
  ).find((m) => m.d === d);
  const confirmed: ChatMessageDto = {
    id: ack.messageId,
    conversationId,
    height: ack.height,
    type: entry.payload.type,
    content: optimistic?.content ?? entry.payload.content,
    sender: optimistic?.sender ?? selfSenderInfo(),
    replyToId: entry.payload.replyToId ?? null,
    d,
    createdAt: entry.createdAt,
  };
  store.ingestMessages(conversationId, [confirmed]);
  store.applyIncomingMessage(confirmed);
}
