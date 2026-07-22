import { fromImUserId, toImUserId } from '@/im/user-id';

/**
 * 解析 1:1 呼叫的被叫 UUID（round 3 review）。
 *
 * 正常入口 sourceID 就是对方 UUID；但推送路由的兜底是
 * `sourceID || conversationID`，会漏进 `si_<a>_<b>`（OpenIM 单聊会话 id，
 * a/b 为去连字符的双方 IM id 升序）。这种形式从会话 id 剔除自己、还原
 * UUID 得到对端；群会话（sg_）与解析失败返回 null，调用方给可控提示。
 */
export function resolveDirectCalleeID(
  rawSourceID: string,
  selfUserID: string,
): string | null {
  const source = rawSourceID?.trim();
  if (!source) return null;
  if (source.startsWith('sg_')) return null;
  if (source.startsWith('si_')) {
    const selfImID = toImUserId(selfUserID);
    const parts = source.slice(3).split('_').filter(Boolean);
    const peer = parts.find((part) => part !== selfImID);
    if (!peer || peer === selfImID) return null;
    const restored = fromImUserId(peer);
    // 还原失败（长度不对等）时返回 null 而不是把坏 id 打给后端
    return restored.includes('-') ? restored : null;
  }
  return fromImUserId(source);
}
