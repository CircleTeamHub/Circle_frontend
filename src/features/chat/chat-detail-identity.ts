import { isChatConversationId } from '@/chat-core/conversation-id';
import { resolveDirectCalleeID } from '@/features/call/resolve-direct-callee';

export type ChatDetailIdentity = {
  /** 可直接用来订阅时间线的会话 id;认不出来时为空串(交给 sourceID 去解析)。 */
  conversationID: string;
  /** 单聊=对端 userID,群聊=圈子 id。聊天页据此建/取会话。 */
  sourceID: string;
};

/**
 * 把聊天页的路由入参归一成「能用的」会话身份。
 *
 * 存在的理由是迁移窗口:升级前入队的 OpenIM 推送不会因为升级而消失,还压在
 * 系统托盘里。用户点开时,旧载荷里的 `si_<a>_<b>`(单聊)/ `sg_<...>`(群聊)
 * 会被推送路由原样当成 conversationID + sourceID 传进聊天页
 * (路由的兜底是 `sourceID || conversationID`)。
 *
 * 这种 id 非空,于是聊天页的 `isPreviewMode = !conversationID` 判成「有会话」:
 * 页面看着完全正常,但订阅到的是一个空时间线,发送也必然失败 —— 而入口只给了
 * 这一个 id,再没有别的路能恢复。
 *
 * 归一规则:
 * - conversationID 必须是本栈会话 id(UUID),否则当作没传;
 * - sourceID 是 `si_` 时按「剔掉自己剩下的那段」还原对端 —— 与「打电话」按钮
 *   同一个还原器,两处不能各写一份;
 * - `sg_`(旧群会话)还原不出圈子 id,原样留着让上层落到预览态,
 *   这比进一个空会话诚实。
 */
export function resolveChatDetailIdentity(params: {
  conversationID: unknown;
  sourceID: unknown;
  currentUserID: string | null;
}): ChatDetailIdentity {
  // 先归一再校验再返回,三步用同一个值。之前 isChatConversationId 内部 trim 过、
  // 这里却把原串交出去 —— 深链带上编码空格(%20)时它被判成合法会话 id,
  // 拿去请求历史和进房间全都对不上,又是一个「页面正常、时间线空、发送必败」。
  const rawConversationID =
    typeof params.conversationID === 'string' ? params.conversationID.trim() : '';
  const rawSourceID =
    typeof params.sourceID === 'string' ? params.sourceID.trim() : '';

  const legacyPeerID = rawSourceID.startsWith('si_')
    ? resolveDirectCalleeID(rawSourceID, params.currentUserID ?? '')
    : null;

  return {
    conversationID: isChatConversationId(rawConversationID)
      ? rawConversationID
      : '',
    sourceID: legacyPeerID ?? rawSourceID,
  };
}
