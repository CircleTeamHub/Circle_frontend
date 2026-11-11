import type { Href } from 'expo-router';

/**
 * 只影响展示或落点、不决定「是哪一页」的参数：标题、头像随时会变；定位到某条消息 /
 * 评论的锚点由 replace 重新带进去。会话页以 sourceID 认会话，conversationID 和会话
 * 类型只是同一会话的另一种写法，从不同入口进来时不一定带全。
 */
const NON_IDENTITY_PARAMS = new Set([
  'title',
  'name',
  'avatarUrl',
  'searchedMsgID',
  'targetCommentId',
  'conversationID',
  'conversationType',
  'conversationKind',
]);

export type CurrentRoute = {
  /**
   * usePathname()：分组已去掉、动态段填的是解码后的原值（expo-router 先解码参数再拼
   * 路径，不重新编码），如 id 为「u 1」时是 /messages/user/u 1。
   */
  pathname: string;
  /** useGlobalSearchParams()：当前页的路径参数和查询参数。 */
  params: Record<string, string | string[] | undefined>;
};

/**
 * 目标是不是用户此刻正看着的这一页。是的话再 push 只会叠出一模一样的一层，
 * 返回时又看到同一页。同名页面但在别的 tab 栈、或换了一个帖子 / 用户，都不算。
 */
export function isCurrentRoute(current: CurrentRoute, route: Href): boolean {
  // 先坍成普通对象再取字段：直接在 Href 巨型联合上索引会触发 TS2590。
  const target = (typeof route === 'string' ? { pathname: route } : route) as {
    pathname: string;
    params?: Record<string, unknown>;
  };
  const params = target.params ?? {};
  const pathParams = new Set<string>();
  const pathname = target.pathname
    .split('/')
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .map((segment) => {
      const dynamic = /^\[(.+)\]$/.exec(segment)?.[1];
      if (!dynamic) return segment;
      pathParams.add(dynamic);
      return String(params[dynamic] ?? '');
    })
    .join('/');
  if (pathname !== current.pathname) return false;
  return Object.entries(params).every(
    ([key, value]) =>
      pathParams.has(key) ||
      NON_IDENTITY_PARAMS.has(key) ||
      String(value ?? '') === String(current.params[key] ?? ''),
  );
}
