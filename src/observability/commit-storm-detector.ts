/**
 * commit-storm-detector.ts — 没人操作时 React 每秒提交十几次、持续好几秒，就报一次。
 *
 * js-stall-detector 只在 JS 线程被占住 3 秒以上时才响。2026-11 的 react-freeze 无限提交
 * （每秒约 24 次「渲染→提交」）要卡到计时器都排不上队才被它看到；FE#300 的会话列表反复
 * 重渲根本不堵线程，只是发热耗电，任何检测都看不到。这里直接数提交次数：手指不在屏幕上、
 * App 在前台，连续 5 秒每秒都有 ≥15 次提交，就是有东西在空转。
 *
 * 生产版渲染器给钩子的优先级是 undefined，分不出哪次提交来自用户输入，所以靠根视图上的
 * 触摸事件排除：手指按着、或松手 2 秒内（惯性滚动）都不算；键盘弹着（打字）也不算。
 *
 * 报的时候顺带找出「是谁在反复渲染」：记下这次提交时整棵树的 fiber，等下一次提交再走一遍。
 * 只被克隆、没真正渲染的 fiber 与上一版共用 props/state 引用；真正渲染过的要么是新对象且
 * props/state 换了，要么是新挂载。取每段渲染区域最上面那个组件的名字（代码标识符，不含
 * 用户内容），就是更新的源头。走树只在报警时做一次。
 */
export const COMMIT_STORM_RATE = 15;
export const COMMIT_STORM_SECONDS = 5;
const INPUT_GRACE_MS = 2000;
// 手指一直按着（录音、长按）也照样算操作中，但抬手事件丢了（被原生模态抢走）不能把检测永久关掉。
const HELD_TOUCH_MAX_MS = 10_000;
const REPORT_COOLDOWN_MS = 10 * 60_000;
const MAX_FIBERS_WALKED = 50_000;
const MAX_HOT_COMPONENTS = 3;
const SUSPENSE_TAG = 13;
const COMPONENT_NAME = /^[A-Za-z_$][\w$.]{0,63}$/;
// 找「在哪个页面/组件里」时跳过 RN 自带的基础组件，否则父级永远是 View。
const PRIMITIVE_NAME = /^(View|Text|Image|TextInput|ScrollView|FlatList|SectionList|Pressable|SafeAreaView|KeyboardAvoidingView|Touchable\w*|Animated\w*|Virtualized\w*|CellRenderer\w*)$/;

type FiberLike = {
  tag?: number;
  type?: unknown;
  child?: FiberLike | null;
  sibling?: FiberLike | null;
  return?: FiberLike | null;
  alternate?: FiberLike | null;
  memoizedProps?: unknown;
  memoizedState?: unknown;
};

export type CommitStorm = {
  commitsPerSecond: number;
  durationMs: number;
  /** 反复渲染区域最上面的组件，如 `Freeze>Suspense`；拿不到名字时为空。 */
  components: readonly string[];
};

export type CommitStormDetectorDeps = {
  now: () => number;
  isAppActive: () => boolean;
  /** 键盘弹着（在打字）：系统键盘的按键不经过 App 的根视图，触摸事件看不到。 */
  isKeyboardVisible: () => boolean;
  onStorm: (storm: CommitStorm) => void;
};

function rootFiberOf(root: unknown): FiberLike | null {
  const current = (root as { current?: unknown } | null)?.current;
  return current && typeof current === 'object' ? (current as FiberLike) : null;
}

function componentName(fiber: FiberLike): string | null {
  if (fiber.tag === SUSPENSE_TAG) return 'Suspense';
  const type = fiber.type as
    | { displayName?: unknown; name?: unknown; render?: { name?: unknown }; type?: { name?: unknown } }
    | null
    | undefined;
  if (!type || (typeof type !== 'function' && typeof type !== 'object')) return null;
  const candidates = [type.displayName, type.name, type.render?.name, type.type?.name];
  const name = candidates.find((value) => typeof value === 'string' && COMPONENT_NAME.test(value));
  return typeof name === 'string' ? name : null;
}

function walk(root: FiberLike, visit: (fiber: FiberLike) => boolean): void {
  // 显式栈：组件树可能很深，递归会撑爆 Hermes 的调用栈。
  const stack: FiberLike[] = [root];
  let walked = 0;
  while (stack.length > 0 && walked < MAX_FIBERS_WALKED) {
    const fiber = stack.pop()!;
    walked += 1;
    const descend = visit(fiber);
    if (fiber.sibling) stack.push(fiber.sibling);
    if (descend && fiber.child) stack.push(fiber.child);
  }
}

function nearestNamedAncestor(fiber: FiberLike): string | null {
  for (let parent = fiber.return; parent; parent = parent.return) {
    const name = componentName(parent);
    if (name && !PRIMITIVE_NAME.test(name)) return name;
  }
  return null;
}

export function snapshotFibers(root: unknown): Set<FiberLike> {
  const seen = new Set<FiberLike>();
  const top = rootFiberOf(root);
  if (top) {
    walk(top, (fiber) => {
      seen.add(fiber);
      return true;
    });
  }
  return seen;
}

function renderedSince(fiber: FiberLike, previous: Set<FiberLike>): boolean {
  if (previous.has(fiber)) return false;
  const alternate = fiber.alternate;
  return (
    !alternate ||
    fiber.memoizedProps !== alternate.memoizedProps ||
    fiber.memoizedState !== alternate.memoizedState
  );
}

/** 上一次提交之后真正渲染过的区域，取每块最上面的组件名（附上最近的具名祖先）。 */
export function findHotComponents(previous: Set<FiberLike>, root: unknown): string[] {
  const top = rootFiberOf(root);
  if (!top) return [];
  const counts = new Map<string, number>();
  walk(top, (fiber) => {
    if (!renderedSince(fiber, previous)) return true;
    const name = componentName(fiber);
    if (!name) return true;
    const parent = nearestNamedAncestor(fiber);
    const label = parent ? `${parent}>${name}` : name;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    // 区域最上面的组件就是源头，往下都是它带着渲染的。
    return false;
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_HOT_COMPONENTS)
    .map(([label]) => label);
}

export function createCommitStormDetector(deps: CommitStormDetectorDeps) {
  let currentSecond = Number.NaN;
  let currentCount = 0;
  let streakSeconds = 0;
  let streakCommits = 0;
  let streakStartedAt = 0;
  let touchesDown = 0;
  let lastInputAt = Number.NEGATIVE_INFINITY;
  let lastReportAt = Number.NEGATIVE_INFINITY;
  let pending: { snapshot: Set<FiberLike>; storm: Omit<CommitStorm, 'components'> } | null = null;

  const resetStreak = () => {
    currentSecond = Number.NaN;
    currentCount = 0;
    streakSeconds = 0;
    streakCommits = 0;
  };

  const inputActive = (at: number) =>
    at - lastInputAt < INPUT_GRACE_MS || (touchesDown > 0 && at - lastInputAt < HELD_TOUCH_MAX_MS);

  const onCommit = (root: unknown) => {
    const at = deps.now();
    if (pending) {
      const { snapshot, storm } = pending;
      pending = null;
      deps.onStorm({ ...storm, components: findHotComponents(snapshot, root) });
      return;
    }
    if (inputActive(at) || deps.isKeyboardVisible() || !deps.isAppActive()) {
      resetStreak();
      return;
    }
    const second = Math.floor(at / 1000);
    if (second !== currentSecond) {
      const continues = second === currentSecond + 1 && currentCount >= COMMIT_STORM_RATE;
      streakSeconds = continues ? streakSeconds + 1 : 0;
      streakCommits = continues ? streakCommits : 0;
      if (!continues) streakStartedAt = at;
      currentSecond = second;
      currentCount = 0;
    }
    currentCount += 1;
    streakCommits += 1;
    if (streakSeconds + 1 < COMMIT_STORM_SECONDS || currentCount < COMMIT_STORM_RATE) return;
    if (at - lastReportAt < REPORT_COOLDOWN_MS) return;
    lastReportAt = at;
    const durationMs = Math.max(1, Math.round(at - streakStartedAt));
    pending = {
      snapshot: snapshotFibers(root),
      storm: {
        commitsPerSecond: Math.round((streakCommits * 1000) / durationMs),
        durationMs,
      },
    };
    resetStreak();
  };

  /** 根视图上每个触摸开始/移动/结束事件都调一次，带上事件后屏幕上还按着几根手指。 */
  const onTouch = (touchesOnScreen: number) => {
    touchesDown = touchesOnScreen;
    lastInputAt = deps.now();
    resetStreak();
  };

  /**
   * 原生滚动 / 手势接管触摸时 RN 只收到 cancel，之后手指还在拖，抬手事件也不会再来：
   * 当作还按着（受 HELD_TOUCH_MAX_MS 兜底）。
   */
  const onTouchCancel = () => {
    onTouch(Math.max(touchesDown, 1));
  };

  return { onCommit, onTouch, onTouchCancel };
}
