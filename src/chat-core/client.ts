import { assertLocalCanSendMessage } from '@/services/api/credit-policy';
import { useAuthStore } from '@/stores/authStore';
import {
  createCircleChatConversation,
  createDirectChatConversation,
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
import type { ChatMessageDto } from './protocol';
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
  /**
   * 跳过信用分门禁。**只给「钱已经动了、这条消息是回执」的场景用。**
   *
   * 目前唯一的合法用法是转账卡片:积分在 TransferComposerScreen 里就已经
   * 通过 sendCoinGift 真扣真到账了,这张卡只是事后的凭据。在这里拦掉它并不
   * 能阻止任何事 —— 只会让付款方看不到卡片、以为没发出去,再从转账页重试一次
   * (那会生成新的幂等键)就是第二次真实扣款。
   *
   * 真正该拦的位置是扣款之前,见 TransferComposerScreen 的 handleSubmit。
   */
  bypassCreditGate?: boolean;
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
  // 唯一的豁免是「钱已经动了」的回执(转账卡片):拦在这里既阻止不了扣款,
  // 又会让付款方以为没发出去而重试 —— 那是第二次真实扣款。详见 bypassCreditGate。
  if (!options.bypassCreditGate) assertLocalCanSendMessage();
  const d = createDeliveryId();
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

  // G-01 outbox:先入队再发送 —— App 在 ack 前被杀,重启后这条会以
  // 「发送失败」气泡还原(长按可重发,同 d 幂等);成功后出队。
  void outboxUpsert({
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
  });
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
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
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

export function sendVoiceMessage(options: {
  conversationId: string;
  key: string;
  duration: number;
  size?: number;
  localUri?: string;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
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
  description: string;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: 'location',
    content: {
      latitude: options.latitude,
      longitude: options.longitude,
      description: options.description,
    },
  });
}

export type ChatCardType =
  | 'note-card'
  | 'friend-card'
  | 'circle-card'
  | 'transfer-card'
  | 'verification-card'
  | 'plaza-post-card';

/** 各类卡片:content 即卡片 payload 本体(渲染侧同一形状,零转换)。 */
export function sendCardMessage(options: {
  conversationId: string;
  type: ChatCardType;
  /** 卡片 payload 本体(NoteCardData 等接口类型无索引签名,收 object 再收窄)。 */
  payload: object;
  onCreate?: (message: ChatMessageDto) => void;
  /** 见 SendOptions.bypassCreditGate —— 只有转账卡片这种「钱已经动了」的回执能用。 */
  bypassCreditGate?: boolean;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: options.type,
    content: options.payload as Record<string, unknown>,
    onCreate: options.onCreate,
    bypassCreditGate: options.bypassCreditGate,
  });
}


/**
 * G-01 重发:失败气泡长按「重发」。复用同一 d(服务端幂等兜底,绝不重复入库);
 * 成功后服务端回声(chat:msg 同 d)会替换掉失败的乐观气泡,outbox 出队。
 */
export async function retryFailedChatMessage(
  conversationId: string,
  d: string,
): Promise<void> {
  const entries = await outboxList();
  const entry = entries.find(
    (item) => item.d === d && item.conversationId === conversationId,
  );
  if (!entry) throw new ChatSendError('CHAT_INVALID_PAYLOAD', '找不到待重发的消息');
  await sendChatMessage(entry.payload);
  void outboxDelete(d);
}
