import { normalizeUserIdAlias } from '@/utils/user-id-alias';

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 解析 1:1 呼叫的被叫 UUID。
 *
 * 正常入口 sourceID 就是对方 UUID;但推送路由的兜底是
 * `sourceID || conversationID`,可能漏进 `direct:<low>:<high>`(自研 1:1
 * 会话 id,双方 UUID 码点升序),或迁移窗口里旧 OpenIM 推送的 `si_<a>_<b>`。
 * 这两种形式都从会话 id 剔除自己得到对端;群会话与解析失败返回 null,
 * 调用方给可控提示。
 */
export function resolveDirectCalleeID(
  rawSourceID: string,
  selfUserID: string,
): string | null {
  const source = rawSourceID?.trim();
  if (!source) return null;
  if (source.startsWith('direct:')) {
    const parts = source.slice('direct:'.length).split(':').filter(Boolean);
    const peer = parts.find((part) => part !== selfUserID);
    return peer && peer !== selfUserID ? peer : null;
  }
  /**
   * 迁移窗口的兼容:升级前入队的 OpenIM 推送可能还压在系统托盘里(升级不会
   * 清掉它们),点开时 push-notification-route 的 `sourceID || conversationID`
   * 兜底会把 `si_<a>_<b>` 原样传进来。这种 id 两段都是用户 id,剔掉自己就是
   * 对端,能安全还原 —— 一律拒的话「打电话」在这条入口上永远只报 initiateFailed。
   *
   * 必须自己确实在这两段里才还原:否则这就不是我的会话 id(伪造深链、
   * 别人的会话 id),猜一个「另一段」等于把任意 id 当对端打给后端。
   *
   * sg_(旧群会话)没有这条退路:两段是群相关 id,还原不出任何人,继续拒。
   */
  if (source.startsWith('si_')) {
    const self = normalizeUserIdAlias(selfUserID ?? '');
    const parts = source
      .slice('si_'.length)
      .split('_')
      .filter(Boolean)
      .map(normalizeUserIdAlias);
    if (parts.length !== 2 || !parts.includes(self)) return null;
    const peer = parts.find((part) => part !== self);
    return peer && UUID_SHAPE.test(peer) ? peer : null;
  }
  if (source.startsWith('sg_')) return null;
  const normalized = normalizeUserIdAlias(source);
  return UUID_SHAPE.test(normalized) ? normalized : null;
}
