type Purge = {
  conversationId?: string;
  clientMessageId?: string;
  serverMessageId?: string;
  expired?: boolean;
  /** 清掉这个会话的全部正文(清空聊天记录)。必须明说,见 encryptedBodyPurgeMatches。 */
  wholeConversation?: boolean;
};
/** 本机加密正文库里的一条,只列清理要看的字段。 */
export type StoredEncryptedBody = {
  conversationId: string;
  clientMessageId: string;
  serverMessageId?: string;
  expiresAt?: string;
};
const listeners = new Set<(value: Purge) => void>();
export function onEncryptedBodyPurge(listener: (value: Purge) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function purgeEncryptedBody(value: Purge) { for (const listener of listeners) listener(value); }

/** 指明了要清哪些:到期的、整个会话、或者至少一个消息标识。 */
export function hasEncryptedBodyPurgeTarget(purge: Purge): boolean {
  if (purge.expired) return true;
  if (!purge.conversationId) return false;
  return Boolean(purge.wholeConversation || purge.clientMessageId || purge.serverMessageId);
}

/**
 * 这一条正文该不该清。
 *
 * 单条清理两个标识都没有时什么都不清。原来会退化成「整个会话都匹配」:一条没有信封的
 * 加密消息(撤回后正文是空对象)焚毁到期,就把这个会话里所有加密消息的正文一起删了,
 * 之后全部显示成解不开。
 */
export function encryptedBodyPurgeMatches(purge: Purge, body: StoredEncryptedBody, now: number): boolean {
  if (purge.expired) return Boolean(body.expiresAt && Date.parse(body.expiresAt) <= now);
  if (!hasEncryptedBodyPurgeTarget(purge) || body.conversationId !== purge.conversationId) return false;
  if (purge.wholeConversation) return true;
  return (!purge.serverMessageId || body.serverMessageId === purge.serverMessageId)
    && (!purge.clientMessageId || body.clientMessageId === purge.clientMessageId);
}
