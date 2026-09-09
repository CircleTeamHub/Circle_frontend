/**
 * 自研聊天线上协议（与 circle_be src/chat/chat.constants.ts + chat.types.ts 镜像）。
 * 事件名与载荷字段是跨仓契约：改动必须两仓同步，
 * test/chat-core-protocol-contract.test.js 在双仓并排检出时会对齐校验。
 */

export const CHAT_WS_PATH = '/chat-ws';

export const CHAT_EVENTS = {
  /** 客户端 → 服务端：发消息（带 ack） */
  send: 'chat:send',
  /** 双向：已读水位（客户端上报带 ack；服务端广播成员推进） */
  read: 'chat:read',
  /** 双向：正在输入 */
  typing: 'chat:typing',
  /** 服务端 → 客户端：新消息 */
  message: 'chat:msg',
  /** 双向：在线状态（客户端带 ack 查询；服务端上下线广播） */
  presence: 'chat:presence',
  /** 服务端 → 客户端（个人房定向）：本人的会话成员关系变化 */
  conversation: 'chat:conversation',
  /** 双向：消息撤回（客户端带 ack 发起；服务端广播到会话房） */
  revoke: 'chat:revoke',
  /** 双向：送达水位（客户端收到 chat:msg 后上报，无 ack；服务端广播推进） */
  delivered: 'chat:delivered',
  /** 双向：表情回应（客户端带 ack；服务端广播到会话房） */
  reaction: 'chat:reaction',
  /** 双向：消息编辑（客户端带 ack；服务端广播到会话房） */
  edit: 'chat:edit',
  /** 服务端 → 客户端：私聊任一方清空后，双方设备同步清空到该水位 */
  historyCleared: 'chat:history_cleared',
} as const;

/** 表情回应白名单（与服务端镜像；越界服务端直接拒）。 */
export const CHAT_REACTION_EMOJIS: readonly string[] = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🙏',
];

export interface ChatSendPayload {
  conversationId: string;
  type: string;
  content: Record<string, unknown>;
  /** 客户端生成的幂等键（deliveryId）：断线重发同一 d，服务端撞库去重。 */
  d: string;
  replyToId?: string;
  /** 媒体转发源消息；服务端重新校验可见性并复制对象。 */
  forwardFromMessageId?: string;
}

export interface ChatReadPayload {
  conversationId: string;
  height: number;
}

export interface ChatSendAckOk {
  ok: true;
  messageId: string;
  height: number;
  d: string;
}

export interface ChatAckError {
  ok: false;
  /** circle_be ChatErrorCode 字符串码（serverErrors.<code> 词表键）。 */
  code: string;
  message?: string;
}

export type ChatSendAck = ChatSendAckOk | ChatAckError;
export type ChatReadAck = { ok: true } | ChatAckError;

export interface ChatSenderInfo {
  id: string;
  nickname: string;
  avatarUrl: string | null;
}

/** 被引用消息的只读快照（G-09 真引用），服务端读路径批量附带。 */
export interface ChatReplyToSnapshot {
  id: string;
  height: number;
  senderNickname: string;
  type: string;
  /** 服务端生成的短摘要；原消息已撤回时为空串。 */
  preview: string;
  revoked: boolean;
}

/** chat:revoke 客户端载荷（带 ack）。 */
export interface ChatRevokePayload {
  conversationId: string;
  messageId: string;
}

/** chat:revoke 服务端广播。 */
export interface ChatRevokeBroadcast {
  conversationId: string;
  messageId: string;
  revokedBy: string;
}

/** chat:delivered 服务端广播（C→S 上报为 {conversationId, height}）。 */
export interface ChatDeliveredBroadcast {
  conversationId: string;
  userId: string;
  height: number;
}

/** chat:reaction 双向载荷（广播多带 userId）。 */
export interface ChatReactionBroadcast {
  conversationId: string;
  messageId: string;
  emoji: string;
  op: 'add' | 'remove';
  userId: string;
}

/** chat:edit 服务端广播。 */
export interface ChatEditBroadcast {
  conversationId: string;
  messageId: string;
  content: Record<string, unknown>;
  editedAt: string;
}

/** 消息上的表情回应聚合（服务端读路径批量附带）。 */
export interface ChatReactionSummary {
  emoji: string;
  userIds: string[];
}

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  /** 会话内单调递增序号；排序 / 已读水位 / 补拉共用坐标系。本地乐观消息为 0。 */
  height: number;
  type: string;
  content: Record<string, unknown>;
  sender: ChatSenderInfo | null;
  replyToId: string | null;
  /** 被引用消息快照（原消息被物理删除时缺省，回落 content.quotedText）。 */
  replyTo?: ChatReplyToSnapshot;
  /** 撤回时间（ISO）；未撤回为 null/缺省。撤回消息仍占 height，content 为空对象。 */
  revokedAt?: string | null;
  revokedBy?: string | null;
  /** 编辑时间（ISO）；未编辑缺省。height 不变。 */
  editedAt?: string | null;
  /** 表情回应聚合；无回应缺省。 */
  reactions?: ChatReactionSummary[];
  /**
   * 所属会话的阅后即焚秒数；null/缺省 = 未开启。
   *
   * 与会话 DTO 上那个是同一个值，逐条消息带一份是有意的：从会话列表缓存里查
   * 这个值要赌「列表已经加载好」，而推送冷启动时消息可能先到 —— 查不到就当成
   * 没开焚毁，原图落盘、长按可存相册，等缓存补齐已经晚了。带在消息上，渲染这
   * 条消息所需的一切就都在消息里。
   *
   * 缺省要按「未知」处理而不是「关」：老后端不发这个字段，此时回落到会话查找。
   */
  burnDurationSec?: number | null;
  /** 幂等键：本地乐观消息靠它与服务端回执/广播对账替换。 */
  d: string | null;
  createdAt: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

/**
 * sender 可以是 null,但**不能缺**。
 *
 * null 是后端的正常输出:系统消息没有发送者,普通消息的发送者也可能已注销
 * (`senders.get(id) ?? null`)—— 所以不能按「非系统消息必须有 sender」去卡,
 * 那会把注销用户发过的历史消息整条丢掉。
 *
 * 缺字段则一定是畸形载荷:后端 toMessageDto 永远显式写 sender 这个键。
 * 原来把 undefined 也放行了,而一条没有 sender 的普通消息进 store 之后,
 * 「这是不是我自己发的回声」判不出来 —— 自己发的会被当成对方来的,
 * 多加一次未读、还弹一条前台横幅。
 */
function isValidSender(value: unknown): boolean {
  if (value === null) return true;
  if (value === undefined) return false;
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value['id']) &&
    typeof value['nickname'] === 'string' &&
    (value['avatarUrl'] === null ||
      value['avatarUrl'] === undefined ||
      typeof value['avatarUrl'] === 'string')
  );
}

/**
 * chat:msg 载荷的运行时校验。
 *
 * 分发器原来只看两个 id 就往 store 里写,于是 content 为 null、height 非法、
 * sender 形状错、createdAt 不可解析的载荷都会被原样落库。最典型的一条:
 * 一个 content=null 的文本消息进了 store,之后 MessagesScreen 渲染时
 * getChatMessagePreview 里 `message.content['text']` 抛异常 —— 那已经在
 * 分发器的 try/catch 之外了,一条畸形广播就能让消息页每次进都白屏。
 *
 * 校验的严格程度按「渲染路径会不会因此炸」来定:
 * - id/conversationId/type/content/height/createdAt 必须可用,缺一不可;
 * - sender 允许为 null(系统消息),但给了就必须是完整形状;
 * - replyToId/d 允许缺省(服务端可能省略 null),类型错才拒。
 */
export function isChatMessageDto(value: unknown): value is ChatMessageDto {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value['id'])) return false;
  if (!isNonEmptyString(value['conversationId'])) return false;
  if (!isNonEmptyString(value['type'])) return false;
  if (!isPlainObject(value['content'])) return false;
  const height = value['height'];
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 0) {
    return false;
  }
  // 时间参与排序与分组;不可解析的话日期分隔线与「昨天」判定会算出 NaN。
  const createdAt = value['createdAt'];
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) {
    return false;
  }
  if (!isValidSender(value['sender'])) return false;
  const replyToId = value['replyToId'];
  if (replyToId !== null && replyToId !== undefined && typeof replyToId !== 'string') {
    return false;
  }
  const d = value['d'];
  if (d !== null && d !== undefined && typeof d !== 'string') return false;
  if (!isValidReactions(value['reactions'])) return false;
  if (!isValidReplySnapshot(value['replyTo'])) return false;
  if (!isOptionalTimestamp(value['revokedAt'])) return false;
  if (!isOptionalTimestamp(value['editedAt'])) return false;
  const revokedBy = value['revokedBy'];
  if (
    revokedBy !== null &&
    revokedBy !== undefined &&
    typeof revokedBy !== 'string'
  ) {
    return false;
  }
  return true;
}

/**
 * 后来加的这几个可选字段一个都没校验过,而它们都在渲染路径上被直接解引用:
 * `reactions: [{ emoji: '👍', userIds: null }]` 这样的载荷能一路存进 store,
 * 然后在 mapChatMessageDtoToUI 读 `r.userIds.length` 时把会话页整个炸掉。
 */
function isValidReactions(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry) =>
      isPlainObject(entry) &&
      isNonEmptyString(entry['emoji']) &&
      Array.isArray(entry['userIds']) &&
      (entry['userIds'] as unknown[]).every((id) => typeof id === 'string'),
  );
}

function isValidReplySnapshot(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isPlainObject(value)) return false;
  const height = value['height'];
  return (
    isNonEmptyString(value['id']) &&
    typeof height === 'number' &&
    Number.isInteger(height) &&
    height >= 0 &&
    typeof value['senderNickname'] === 'string' &&
    typeof value['type'] === 'string' &&
    typeof value['preview'] === 'string' &&
    typeof value['revoked'] === 'boolean'
  );
}

function isOptionalTimestamp(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export interface ChatReadBroadcast {
  conversationId: string;
  userId: string;
  height: number;
}

/** 私聊双方清空广播；群聊的个人清空不会发送该事件。 */
export interface ChatHistoryClearedBroadcast {
  conversationId: string;
  clearedBeforeHeight: number;
  clearedBy: string;
}

/**
 * chat:conversation 的变化种类（镜像 circle_be chat.types.ts）:
 * joined=入座 / left=本人主动退出 / removed=被移出·解散·停用 / updated=预留。
 */
export type ChatConversationChangeKind =
  | 'joined'
  | 'left'
  | 'removed'
  | 'updated';

/** chat:conversation 服务端定向下发:接收者本人的会话成员关系变化。 */
export interface ChatConversationBroadcast {
  kind: ChatConversationChangeKind;
  conversationId: string;
  userId: string;
}

export interface ChatTypingBroadcast {
  conversationId: string;
  userId: string;
}

/**
 * 离线撤回/编辑增量(REST GET /chat/messages/mutations)。
 * 镜像 circle_be chat.types.ts 的 ChatMutationsPageDto。
 */
export interface ChatMutationsPageDto {
  messages: ChatMessageDto[];
  /** 本次响应的服务端时刻。 */
  serverTime: string;
  /** 下一次请求应当传的 since(被截断时它停在本页最后一次变更上)。 */
  nextSince: string;
  /**
   * 与 nextSince 配对的 id 游标(复合 keyset)。毫秒精度下同刻并列很常见,
   * 只带时间戳的游标会把剩下那些同刻的行永久跳过。未截断时为空串。
   */
  nextSinceId: string;
  /** 还有没追完的变更;为 true 应当立刻再拉一页。 */
  hasMore: boolean;
  /**
   * 请求的 since 比服务端保留窗口还老,那段区间的变更已查不到 ——
   * 必须丢掉本地消息缓存重新拉,否则那段时间被撤回的消息会永远显示原文。
   */
  resetRequired: boolean;
}

/** 历史分页(REST GET /chat/conversations/:id/messages)。 */
export interface ChatHistoryPageDto {
  messages: ChatMessageDto[];
  /** 继续向前翻页的 beforeHeight;没有更早消息时为 null。 */
  nextBeforeHeight: number | null;
  /** afterHeight 增量补拉的续拉游标;已追平为 null(仅 afterHeight 查询返回)。 */
  nextAfterHeight?: number | null;
}

/** chat:presence 服务端广播。 */
export interface ChatPresenceBroadcast {
  userId: string;
  online: boolean;
}

/** 会话成员(GET /chat/conversations/:id/members);role 仅 GROUP 有值。 */
export interface ChatMemberDto {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  /** 群角色:圈子群来自 CircleMember;独立群聊 = ownerId / 座位上的管理员标记。 */
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
  /** 禁言中(不能发言;与免打扰无关)。可选兼容老后端。 */
  silenced?: boolean;
  /** 禁言到期时刻;silenced 且为 null = 直到解除。 */
  silencedUntil?: string | null;
}

/** 群策略开关(PATCH /chat/conversations/:id/policies;群主/管理员可改)。 */
export interface ChatGroupPoliciesDto {
  /** 普通成员能否拉人进群(圈子群 = Circle.memberCanInvite)。 */
  memberCanInvite: boolean;
  /** 群二维码能否入群。 */
  qrJoinEnabled: boolean;
  /** 普通成员能否从群里打开其他成员资料。 */
  membersCanViewProfiles: boolean;
  /** 普通成员能否通过群加其他成员为好友。 */
  membersCanAddFriends: boolean;
}

/** 禁言/解除禁言的响应:目标成员的最新禁言状态。 */
export interface ChatMemberSilenceDto {
  userId: string;
  silenced: boolean;
  silencedUntil: string | null;
}

/**
 * 群事件账本(群日志)的种类 —— 与后端 ChatGroupEventKind 逐项镜像。
 * 未知种类(后端先发新版本)由 groupEventText 兜底成「群聊活动」,不会渲染空行。
 */
export type ChatGroupEventKind =
  | 'group-created'
  | 'member-joined'
  | 'member-left'
  | 'member-removed'
  | 'member-role-changed'
  | 'member-silenced'
  | 'member-unsilenced'
  | 'owner-transferred'
  | 'group-renamed'
  | 'group-notice-updated'
  | 'group-avatar-updated'
  | 'mute-all-changed'
  | 'policy-changed'
  | 'history-cleared';

/** 群日志一条(GET /chat/conversations/:id/events)。 */
export interface ChatGroupEventDto {
  id: string;
  kind: ChatGroupEventKind | (string & {});
  /** 操作者;null = 系统/圈子对账。已注销账号昵称为空串。 */
  actor: ChatSenderInfo | null;
  /** 受影响成员(进群可多人)。 */
  targets: ChatSenderInfo[];
  /** {name} / {role} / {durationSec} / {via}。 */
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ChatGroupEventsPageDto {
  events: ChatGroupEventDto[];
  /** 继续向更早翻页的游标;到头为 null。 */
  nextCursor: string | null;
}

export type ChatConversationType = 'DIRECT' | 'GROUP' | 'TEMP' | 'SUPPORT';

/**
 * 会话 id 是不透明的 UUID —— **看 id 判断不出会话类型**。
 *
 * 这里原来有个 `isDirectConversationId()`,断言 1:1 会话 id 形如
 * `direct:<uuid>:<uuid>`。那个断言是错的:后端 `ChatConversation.id` 是
 * `@default(uuid())`,`直连防重键 directKey`(`<low>:<high>`)只做唯一约束、
 * 从不出服务端。于是它对**每一个**真实会话都返回 false,依赖它的分支全是死代码。
 *
 * 需要知道会话类型时,只能读 `ChatConversationDto.type`(即先要有会话元信息);
 * 元信息还没到就等补拉,别从 id 上猜。
 */

export interface ChatCircleInfo {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ChatTempChatInfo {
  id: string;
  title: string;
}

export interface ChatConversationDto {
  id: string;
  type: ChatConversationType;
  peer: ChatSenderInfo | null;
  circleId: string | null;
  /** GROUP 会话的圈子展示信息(群名/群头像);其余类型为 null。 */
  circle: ChatCircleInfo | null;
  /** 独立群聊(GROUP 且 circleId=null)的群名;可选兼容老后端。 */
  name?: string | null;
  /** 独立群聊的群主 userId;可选兼容老后端。 */
  ownerId?: string | null;
  /** TEMP 会话的房间名。可选用于兼容尚未升级的后端。 */
  tempChat?: ChatTempChatInfo | null;
  lastMessage: ChatMessageDto | null;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  /** 本人在该会话被禁言(仅 GROUP 会为 true)。可选兼容老后端。 */
  silenced?: boolean;
  /** 本人禁言到期时刻;silenced 且为 null = 直到解除。 */
  silencedUntil?: string | null;
  /** 全员禁言中(仅 GROUP;群主/管理员不受限)。可选兼容老后端。 */
  muteAll?: boolean;
  /** 独立群聊公告;圈子群走圈子详情。 */
  notice?: string | null;
  /** 独立群聊头像;圈子群走 circle.avatarUrl。 */
  avatarUrl?: string | null;
  /** 独立群聊成员上限;圈子群走圈子详情。 */
  memberLimit?: number | null;
  /** 本人在该群的角色(仅 GROUP)。 */
  myRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
  /** 群策略开关(仅 GROUP)。 */
  policies?: ChatGroupPoliciesDto | null;
  /** 会话级阅后即焚秒数（S-01）；null/缺省 = 关。 */
  burnDurationSec?: number | null;
  lastMessageAt: string | null;
}

/**
 * 服务端签发的回执类消息 —— 客户端**不发**这些类型。
 *
 * 它们断言的是已经发生过的服务端事实(钱已划走、某人被邀请当验证人),
 * 后端把它们收在 SERVER_MESSAGE_TYPES 里,客户端发一律被拒。转账卡由
 * CoinService 结算提交后签发,验证卡由 CircleInvitationService 加验证人后签发。
 *
 * 这份清单现在**只剩一个用途**:清理旧版本客户端留在本地 outbox 里的脏条目。
 * 那些版本会把这两类卡当普通消息发,发送必失败、条目就永远留在队列里 ——
 * 而 outbox 回放的自愈判据是「同 d 已确认」,后端那张卡用的却是
 * `gift_card_<id>` / `verification_card_<...>`,两个键永远对不上。结果是每次
 * 冷启动都还原出一张发不出去的幽灵卡,赖在时间线最底下(height=0 排最后),
 * 会话列表还一直挂着「发送失败」前缀。见 socket-manager 的 outbox 回放。
 *
 * 发送路径上已经没有它的位置了(没有任何类型能命中),所以别再往回加排除分支;
 * 装机量里没有旧版本之后,这份清单连同那处清理一起删掉即可。
 */
export const SERVER_COMPENSATED_TYPES = new Set<string>([
  'transfer-card',
  'verification-card',
]);
