import { normalizeUserIdAlias } from '@/utils/user-id-alias';

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 解析 1:1 呼叫的被叫 UUID。
 *
 * 正常入口 sourceID 就是对方 UUID;但推送路由的兜底是
 * `sourceID || conversationID`,可能漏进 `direct:<low>:<high>`(自研 1:1
 * 会话 id,双方 UUID 码点升序)。这种形式从会话 id 剔除自己得到对端;
 * 群会话与解析失败返回 null,调用方给可控提示。
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
  // 旧栈会话 id(si_/sg_)已不再产生,无法可靠还原,一律判失败。
  if (source.startsWith('si_') || source.startsWith('sg_')) return null;
  const normalized = normalizeUserIdAlias(source);
  return UUID_SHAPE.test(normalized) ? normalized : null;
}
