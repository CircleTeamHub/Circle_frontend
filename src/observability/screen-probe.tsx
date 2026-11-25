/**
 * screen-probe.tsx — 挂在每个叶子页面外面的探针（经叶子栈的 screenLayout），管两件事：
 *
 * 1. 首次渲染慢：从探针开始渲染到整页第一次提交（子树的 layout effect 全跑完）的耗时，记成
 *    指标；超过 1 秒的按页面报一次。FE#371「进页慢一秒」就是 native-stack 在等这次提交。
 * 2. 根栈里出现多份 (tabs)：React Navigation 7 在某些跨 tab 跳转下会再压一份 (tabs)，
 *    之后返回会走进死路（见 countRouteCopies）。
 *
 * 页面名是「所在栈 + 路由模板名」（如 `/(tabs)/explore/index`），不是实际参数，不含任何标识符。
 * 以前还查过「切回来没解冻」（FE#354）；导航器不再开 freezeOnBlur 后没有冻结了，已删。
 */
import React, { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { diagnosticNow } from './http-diagnostics';
import { recordMetric } from './metrics';
import { reportHandledFailure, toStableCode } from './report-failure';
import { markWebStartupStage } from './web-startup';
import WebScreenReady from './web-screen-ready';

export const SLOW_SCREEN_MS = 1000;
const REPORT_COOLDOWN_MS = 10 * 60_000;

const lastReportedAt = new Map<string, number>();
// 冷启动的第一个页面和启动一起渲染（store 水合、字体、整张列表），量的是启动耗时，
// 归 Sentry 的 app start；不跳过的话每次冷启动都会报一条「页面慢」。
let firstScreenSeen = false;
// 渲染开始后进过后台的话，iOS 会把 JS 整段挂起，回前台才提交：量到的是挂起时长，不是渲染。
let lastBackgroundAt = Number.NEGATIVE_INFINITY;
AppState.addEventListener('change', (state) => {
  if (state === 'background') lastBackgroundAt = diagnosticNow();
});

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
  lastBackgroundAt = Number.NEGATIVE_INFINITY;
}

type NavigationLike = {
  getId(): string | undefined;
};

type LayoutProps = {
  route: { name: string };
  navigation: NavigationLike;
  children: ReactNode;
};

/** 六个 tab 的首页都叫 index：前面拼上所在栈。expo-router 拿布局路径（如 `/(tabs)/explore`）当导航器 id。 */
function pageName(navigation: NavigationLike, routeName: string): string {
  const stack = navigation.getId();
  return stack ? `${stack}/${routeName}` : routeName;
}

const ScreenProbe: React.FC<LayoutProps> = ({ route, navigation, children }) => {
  const [renderStartedAt] = useState(diagnosticNow);
  // 靠这个 ref 保证只量一次，`[]` 保证不了：页面被 Suspense 藏起再显示时（如冻结后解冻），
  // React 会重跑 layout effect，量出来的是「首渲到重新显示」整段（REACT-NATIVE-D2 的 26 秒）。
  const measured = useRef(false);

  const measureFirstCommit = useCallback(() => {
    if (measured.current) return;
    measured.current = true;
    if (Platform.OS !== 'web') markWebStartupStage('page');
    if (!firstScreenSeen) {
      firstScreenSeen = true;
      return;
    }
    if (lastBackgroundAt >= renderStartedAt || AppState.currentState === 'background') return;
    const durationMs = Math.round(diagnosticNow() - renderStartedAt);
    recordMetric('screen.first_commit.duration', durationMs);
    if (durationMs < SLOW_SCREEN_MS) return;
    const page = pageName(navigation, route.name);
    reportAtMostEvery(`slow:${page}`, () => {
      reportHandledFailure('render', 'slowScreen', new Error(`slow first commit ${page}`), {
        page,
        durationMs,
        code: toStableCode(page),
      });
    });
  }, [navigation, renderStartedAt, route.name]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') measureFirstCommit();
  }, [measureFirstCommit]);

  return <WebScreenReady onReady={measureFirstCommit}>{children}</WebScreenReady>;
};

/** 叶子栈的 screenLayout：量每个页面的首次渲染。 */
export function probeScreenLayout(props: LayoutProps): React.ReactElement {
  return <ScreenProbe {...props} />;
}

/** Root groups have their own leaf probes; the root index is only a startup redirect. */
export function probeRootScreenLayout(props: LayoutProps): React.ReactElement {
  if (props.route.name === 'index' || props.route.name.startsWith('(')) return <>{props.children}</>;
  return probeScreenLayout(props);
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
