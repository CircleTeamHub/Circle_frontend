/**
 * screen-probe.tsx — 挂在每个页面外面的探针（经导航器的 screenLayout），管三件事：
 *
 * 1. 切回来没解冻：页面拿到焦点后 1.5 秒内它自己的子树一次都没重新提交，就是冻结没解开。
 *    FE#354 点 tab 停在上一页（RNS#4518 延迟冻结）就是这样：导航状态切过去了，画面没动。
 *    焦点事件来自导航器的事件派发，不受冻结影响；探针收到后改一下自己的 state，这次更新
 *    只有解冻后才能提交——提交了就清掉计时器，到点还没提交就报。
 * 2. 首次渲染慢：从探针开始渲染到整页第一次提交（子树的 layout effect 全跑完）的耗时，记成
 *    指标；超过 1 秒的按页面报一次。FE#371「进页慢一秒」就是 native-stack 在等这次提交。
 * 3. 根栈里出现多份 (tabs)：React Navigation 7 在某些跨 tab 跳转下会再压一份 (tabs)，
 *    之后返回会走进死路（见 countRouteCopies）。
 *
 * 页面名用路由模板名（如 `circle/[id]`），不是实际参数，不含任何标识符。
 */
import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { diagnosticNow } from './http-diagnostics';
import { recordMetric } from './metrics';
import { reportHandledFailure, toStableCode } from './report-failure';

export const FROZEN_AFTER_FOCUS_MS = 1500;
export const SLOW_SCREEN_MS = 1000;
// 计时器自己迟到这么久，说明是 JS 线程整个卡住了（归 js-stall-detector），不是冻结。
const TIMER_LATE_TOLERANCE_MS = 1000;
const REPORT_COOLDOWN_MS = 10 * 60_000;

const lastReportedAt = new Map<string, number>();
// 冷启动的第一个页面和启动一起渲染（store 水合、字体、整张列表），量的是启动耗时，
// 归 Sentry 的 app start；不跳过的话每次冷启动都会报一条「页面慢」。
let firstScreenSeen = false;

function reportAtMostEvery(key: string, report: () => void): void {
  const at = diagnosticNow();
  const last = lastReportedAt.get(key);
  if (last !== undefined && at - last < REPORT_COOLDOWN_MS) return;
  lastReportedAt.set(key, at);
  report();
}

/** 测试隔离用。 */
export function resetScreenProbeReports(): void {
  lastReportedAt.clear();
  firstScreenSeen = false;
}

type NavigationLike = {
  addListener(type: 'focus', listener: () => void): () => void;
};

type LayoutProps = {
  route: { name: string };
  navigation: NavigationLike;
  children: ReactNode;
};

type ProbeProps = LayoutProps & { measureFirstCommit: boolean };

const ScreenProbe: React.FC<ProbeProps> = ({ route, navigation, children, measureFirstCommit }) => {
  const renderStartedAt = useRef<number | null>(null);
  if (renderStartedAt.current === null) renderStartedAt.current = diagnosticNow();
  const [focusCount, setFocusCount] = useState(0);
  const awaitingCommit = useRef(false);
  const page = route.name;

  useLayoutEffect(() => {
    if (!measureFirstCommit || renderStartedAt.current === null) return;
    if (!firstScreenSeen) {
      firstScreenSeen = true;
      return;
    }
    const durationMs = Math.round(diagnosticNow() - renderStartedAt.current);
    recordMetric('screen.first_commit.duration', durationMs);
    if (durationMs < SLOW_SCREEN_MS) return;
    reportAtMostEvery(`slow:${page}`, () => {
      reportHandledFailure('render', 'slowScreen', new Error(`slow first commit ${page}`), {
        page,
        durationMs,
        code: toStableCode(page),
      });
    });
    // 只量第一次提交。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 在提交里同步清掉（layout effect）：passive effect 可能排在检查计时器后面，
  // 页面渲染很重时会把「慢」误判成「没解冻」。
  useLayoutEffect(() => {
    awaitingCommit.current = false;
  }, [focusCount]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = navigation.addListener('focus', () => {
      const focusedAt = diagnosticNow();
      awaitingCommit.current = true;
      setFocusCount((count) => count + 1);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const late = diagnosticNow() - focusedAt - FROZEN_AFTER_FOCUS_MS;
        if (!awaitingCommit.current || late > TIMER_LATE_TOLERANCE_MS) return;
        if (AppState.currentState !== 'active') return;
        reportAtMostEvery(`frozen:${page}`, () => {
          reportHandledFailure('navigation', 'focusedScreenFrozen', new Error(`screen stayed frozen ${page}`), {
            page,
            code: toStableCode(page),
          });
        });
      }, FROZEN_AFTER_FOCUS_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [navigation, page]);

  return <>{children}</>;
};

/** 叶子页面用：量首次渲染 + 查冻结。 */
export function probeScreenLayout(props: LayoutProps): React.ReactElement {
  return <ScreenProbe {...props} measureFirstCommit />;
}

/** 里面装的是另一个导航器（根栈的 (tabs)、tab 页的子栈）：只查冻结，首次渲染归里面的页面量。 */
export function probeNavigatorLayout(props: LayoutProps): React.ReactElement {
  return <ScreenProbe {...props} measureFirstCommit={false} />;
}

type NavigationStateLike = {
  routes?: readonly { name?: string; state?: NavigationStateLike }[];
};

/** 整棵导航状态里，同一个导航器下同名路由最多出现了几份。 */
export function countRouteCopies(state: NavigationStateLike | undefined, name: string): number {
  if (!state?.routes) return 0;
  const here = state.routes.filter((route) => route.name === name).length;
  return state.routes.reduce((max, route) => Math.max(max, countRouteCopies(route.state, name)), here);
}

/** 根导航容器每次状态变化调一次。 */
export function checkNavigationShape(state: NavigationStateLike | undefined): void {
  const copies = countRouteCopies(state, '(tabs)');
  if (copies < 2) return;
  reportAtMostEvery('duplicateTabs', () => {
    reportHandledFailure('navigation', 'duplicateTabs', new Error('navigation state holds several (tabs)'), {
      routeCount: copies,
    });
  });
}
