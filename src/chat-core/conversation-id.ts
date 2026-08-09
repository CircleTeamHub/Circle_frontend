/**
 * 会话 id 的形状判定。
 *
 * 自研栈的会话 id 是后端 `ChatConversation.id`,即一个不透明 UUID ——
 * 从 id 上读不出会话类型,也拼不出会话身份,能做的只有「这是不是一个
 * 本栈会话 id」。
 *
 * 需要它的原因是迁移窗口:升级前入队的 OpenIM 推送不会因为升级而消失,
 * 还压在系统托盘里。用户点开时,旧载荷里的 `si_<a>_<b>` / `sg_<...>`
 * 会被路由原样当成 conversationID 传进聊天页。这种 id 非空,于是聊天页
 * 认定「有会话」——订阅到一个空时间线,发送必然失败,而页面看上去完全正常。
 */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 是不是一个本栈会话 id(UUID)。旧栈的 si_/sg_ 与任何拼接形态都为 false。 */
export function isChatConversationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_SHAPE.test(value.trim());
}
