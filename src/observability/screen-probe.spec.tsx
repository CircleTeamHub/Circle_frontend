import React from 'react';
import { AppState, Text } from 'react-native';
import { renderAsync } from '@testing-library/react-native';
import { Freeze } from 'react-freeze';
import {
  checkNavigationShape,
  countRouteCopies,
  probeScreenLayout,
  resetScreenProbeReports,
  SLOW_SCREEN_MS,
} from './screen-probe';

const mockReportHandledFailure = jest.fn();
const mockRecordMetric = jest.fn();
let mockNow = 0;

jest.mock('./report-failure', () => ({
  reportHandledFailure: (...args: unknown[]) => mockReportHandledFailure(...args),
  toStableCode: jest.requireActual('./report-failure').toStableCode,
}));
jest.mock('./metrics', () => ({
  recordMetric: (...args: unknown[]) => mockRecordMetric(...args),
}));
jest.mock('./http-diagnostics', () => ({
  diagnosticNow: () => mockNow,
}));

// 探针在模块加载时注册的前后台监听（RN 的 jest 桩把 addEventListener 记成 jest.fn）。
const appStateCall = jest.mocked(AppState.addEventListener).mock.calls.find(([type]) => type === 'change');
const emitAppState = appStateCall?.[1] as (state: string) => void;

const navigationIn = (stack: string | undefined) => ({ getId: () => stack });

function SlowContent(): React.ReactElement {
  mockNow += SLOW_SCREEN_MS + 200;
  return <Text>slow</Text>;
}

/** 冷启动的第一个页面不计，先用一个页面占掉它。 */
async function startUp(): Promise<void> {
  const startup = await renderAsync(
    probeScreenLayout({ route: { name: 'index' }, navigation: navigationIn('/(tabs)/messages'), children: <Text>home</Text> }),
  );
  await startup.unmountAsync();
}

beforeEach(() => {
  // RN 的 jest 桩里 currentState 是个 jest.fn，不是 'active'。
  (AppState as unknown as { currentState: string }).currentState = 'active';
  mockNow = 0;
  mockReportHandledFailure.mockClear();
  mockRecordMetric.mockClear();
  resetScreenProbeReports();
});

test('the first page of a cold start is startup cost, not a slow page', async () => {
  await renderAsync(probeScreenLayout({ route: { name: 'index' }, navigation: navigationIn('/(tabs)/messages'), children: <SlowContent /> }));

  expect(mockRecordMetric).not.toHaveBeenCalled();
  expect(mockReportHandledFailure).not.toHaveBeenCalled();
});

test('a page whose first commit takes over a second is recorded and reported by stack and route template', async () => {
  await startUp();
  await renderAsync(
    probeScreenLayout({ route: { name: 'circle/[id]' }, navigation: navigationIn('/(tabs)/explore'), children: <SlowContent /> }),
  );

  expect(mockRecordMetric).toHaveBeenCalledWith('screen.first_commit.duration', SLOW_SCREEN_MS + 200);
  expect(mockReportHandledFailure).toHaveBeenCalledWith('render', 'slowScreen', expect.any(Error), {
    page: '/(tabs)/explore/circle/[id]',
    durationMs: SLOW_SCREEN_MS + 200,
    // fingerprint 只收 [A-Za-z0-9_.-]。
    code: 'tabs.explore.circle.id',
  });
});

test('every tab has a home page called index; each one is its own page (REACT-NATIVE-D2 only said "index")', async () => {
  await startUp();
  for (const stack of ['/(tabs)/explore', '/(tabs)/profile']) {
    await renderAsync(probeScreenLayout({ route: { name: 'index' }, navigation: navigationIn(stack), children: <SlowContent /> }));
  }

  expect(mockReportHandledFailure.mock.calls.map(([, , , context]) => context.page)).toEqual([
    '/(tabs)/explore/index',
    '/(tabs)/profile/index',
  ]);
});

test('a render that straddles a trip to the background is not timed', async () => {
  await startUp();
  emitAppState('background');
  mockNow += 5000;
  emitAppState('active');
  function SuspendedMidRender(): React.ReactElement {
    // iOS 挂起了 JS：回前台才接着渲染、提交。
    emitAppState('background');
    mockNow += 26_000;
    emitAppState('active');
    return <Text>late</Text>;
  }
  await renderAsync(probeScreenLayout({ route: { name: 'index' }, navigation: navigationIn('/(tabs)/explore'), children: <SuspendedMidRender /> }));
  expect(mockRecordMetric).not.toHaveBeenCalled();

  // 渲染开始之前的那次后台不算：照常计时。
  await renderAsync(probeScreenLayout({ route: { name: 'note-ranking' }, navigation: navigationIn('/(tabs)/explore'), children: <SlowContent /> }));
  expect(mockRecordMetric).toHaveBeenCalledWith('screen.first_commit.duration', SLOW_SCREEN_MS + 200);
});

test('a page hidden by Suspense and shown again is not timed again (REACT-NATIVE-D2)', async () => {
  const navigation = navigationIn('/(tabs)/explore');
  const page = (name: string, hidden: boolean) => (
    <Freeze freeze={hidden}>{probeScreenLayout({ route: { name }, navigation, children: <Text>{name}</Text> })}</Freeze>
  );
  // 重新显示时 React 会重跑 layout effect；冷启动的第一个页面也不能补量（量的会是「冷启动到现在」）。
  const startup = await renderAsync(page('home', false));
  await startup.rerenderAsync(page('home', true));
  mockNow += 26_000;
  await startup.rerenderAsync(page('home', false));
  expect(mockRecordMetric).not.toHaveBeenCalled();

  const explore = await renderAsync(page('index', false));
  expect(mockRecordMetric).toHaveBeenCalledTimes(1);
  await explore.rerenderAsync(page('index', true));
  mockNow += 26_000;
  await explore.rerenderAsync(page('index', false));

  expect(mockRecordMetric).toHaveBeenCalledTimes(1);
  expect(mockReportHandledFailure).not.toHaveBeenCalled();
});

test('two copies of (tabs) anywhere in the navigation state are reported', () => {
  const healthy = { routes: [{ name: '(tabs)', state: { routes: [{ name: 'messages' }] } }, { name: 'quick-chat' }] };
  const doubled = {
    routes: [{ name: '__root', state: { routes: [{ name: '(tabs)' }, { name: 'chat-sheet' }, { name: '(tabs)' }] } }],
  };
  expect(countRouteCopies(healthy, '(tabs)')).toBe(1);
  expect(countRouteCopies(doubled, '(tabs)')).toBe(2);

  checkNavigationShape(healthy);
  expect(mockReportHandledFailure).not.toHaveBeenCalled();
  checkNavigationShape(doubled);
  expect(mockReportHandledFailure).toHaveBeenCalledWith('navigation', 'duplicateTabs', expect.any(Error), {
    routeCount: 2,
  });
});
