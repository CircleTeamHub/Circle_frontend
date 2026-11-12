/**
 * 全局防连点：同一个目标在一小段时间内只跳一次。
 *
 * 双击列表行、或者转场途中再点一下，都会对同一个 href 再发一次 push/navigate，
 * 叠出两层一模一样的页面（返回时要按两次）。各页面以前各自写守卫、而且常在
 * finally 里立刻解锁，挡不住转场那几百毫秒。这里在路由层统一兜底：
 * - 只拦「同一个目标」：跳向不同页面不受影响。
 * - 只包 push / navigate：replace、back、dismiss 是用户明确的动作，不拦。
 *
 * 需要先等网络再跳的入口（建会话再进聊天），网络慢时两次跳转可能隔得比窗口还久，
 * 那些入口另用 useNavigationLock（回到本页才解锁）。
 */

/** 转场动画约 300–500ms，留足余量。 */
export const DUPLICATE_NAVIGATION_WINDOW_MS = 800;

type NavigateFn = (href: never, ...rest: never[]) => void;

interface NavigationTarget {
  push: NavigateFn;
  navigate: NavigateFn;
}

const INSTALLED = Symbol.for('circle.navigationDedupeInstalled');

/** href 可能是字符串或 { pathname, params }；按序列化后的内容判断是不是同一个目标。 */
export function navigationKey(href: unknown): string {
  return typeof href === 'string' ? href : JSON.stringify(href);
}

export function installNavigationDedupe(
  target: NavigationTarget,
  now: () => number = Date.now,
): void {
  const marked = target as NavigationTarget & { [INSTALLED]?: boolean };
  // Fast Refresh 会重新执行根布局：只包一次，否则窗口判断会套娃。
  if (marked[INSTALLED]) return;
  marked[INSTALLED] = true;

  let last: { key: string; at: number } | null = null;
  const guard = (method: NavigateFn): NavigateFn =>
    ((href: never, ...rest: never[]) => {
      const key = navigationKey(href);
      const at = now();
      if (last && last.key === key && at - last.at < DUPLICATE_NAVIGATION_WINDOW_MS) return;
      last = { key, at };
      method(href, ...rest);
    }) as NavigateFn;

  target.push = guard(target.push);
  target.navigate = guard(target.navigate);
}
