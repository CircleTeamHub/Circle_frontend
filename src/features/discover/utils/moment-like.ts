import { setMomentLike } from '@/services/api/moments';

export type MomentLikeState = { liked: boolean; likeCount: number };

// feed 与详情页共用:详情页可能在 feed 那次点赞还没回来时就打开了。
const likesInFlight = new Set<string>();

/**
 * 点赞 / 取消赞:先乐观显示,再以服务端回的 { liked, likeCount } 为准;失败回滚到
 * 点之前的样子。同一条动态同时只有一个请求在飞,飞行中的点击直接丢掉 —— 弱网下
 * 连点不会叠出一串请求,也不会有晚到的旧响应把新状态盖回去。
 */
export async function toggleMomentLikeOnce(
  momentId: string,
  current: MomentLikeState,
  apply: (state: MomentLikeState) => void,
): Promise<void> {
  if (likesInFlight.has(momentId)) return;
  likesInFlight.add(momentId);
  const liked = !current.liked;
  apply({ liked, likeCount: current.likeCount + (liked ? 1 : -1) });
  try {
    apply(await setMomentLike(momentId, liked));
  } catch (error) {
    apply(current);
    throw error;
  } finally {
    likesInFlight.delete(momentId);
  }
}
