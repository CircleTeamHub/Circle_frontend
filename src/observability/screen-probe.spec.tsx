import React from 'react';
import { AppState, Text } from 'react-native';
import { act, renderAsync } from '@testing-library/react-native';
import { Freeze } from 'react-freeze';
import {
  checkNavigationShape,
  countRouteCopies,
  FROZEN_AFTER_FOCUS_MS,
  probeNavigatorLayout,
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

function fakeNavigation() {
  const listeners = new Set<() => void>();
  return {
    addListener: (_type: 'focus', listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emitFocus: () => listeners.forEach((listener) => listener()),
  };
}

/** 冻结与否由外层决定，与 react-native-screens 的 freezeOnBlur 相同：探针在冻结边界里面。 */
function Screen({ frozen, navigation }: { frozen: boolean; navigation: ReturnType<typeof fakeNavigation> }) {
  return (
    <Freeze freeze={frozen}>
      {probeNavigatorLayout({ route: { name: 'messages' }, navigation, children: <Text>messages</Text> })}
    </Freeze>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  // RN 的 jest 桩里 currentState 是个 jest.fn，不是 'active'。
  (AppState as unknown as { currentState: string }).currentState = 'active';
  mockNow = 0;
  mockReportHandledFailure.mockClear();
  mockRecordMetric.mockClear();
  resetScreenProbeReports();
});

afterEach(() => {
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    mockNow += ms;
    jest.advanceTimersByTime(ms);
  });
}

test('a screen that gets focus but stays frozen is reported once', async () => {
  const navigation = fakeNavigation();
  const { rerenderAsync } = await renderAsync(<Screen frozen={false} navigation={navigation} />);
  await rerenderAsync(<Screen frozen navigation={navigation} />);

  await act(async () => navigation.emitFocus());
  await advance(FROZEN_AFTER_FOCUS_MS);

  expect(mockReportHandledFailure).toHaveBeenCalledTimes(1);
  expect(mockReportHandledFailure).toHaveBeenCalledWith(
    'navigation',
    'focusedScreenFrozen',
    expect.any(Error),
    { page: 'messages', code: 'messages' },
  );

  await act(async () => navigation.emitFocus());
  await advance(FROZEN_AFTER_FOCUS_MS);
  expect(mockReportHandledFailure).toHaveBeenCalledTimes(1);
});

test('a screen that thaws when it gets focus is fine', async () => {
  const navigation = fakeNavigation();
  const { rerenderAsync } = await renderAsync(<Screen frozen navigation={navigation} />);

  await act(async () => navigation.emitFocus());
  await rerenderAsync(<Screen frozen={false} navigation={navigation} />);
  await advance(FROZEN_AFTER_FOCUS_MS);

  expect(mockReportHandledFailure).not.toHaveBeenCalled();
});

test('a frozen screen is not reported once the app has left the foreground', async () => {
  const navigation = fakeNavigation();
  const { rerenderAsync } = await renderAsync(<Screen frozen={false} navigation={navigation} />);
  await rerenderAsync(<Screen frozen navigation={navigation} />);

  await act(async () => navigation.emitFocus());
  (AppState as unknown as { currentState: string }).currentState = 'background';
  await advance(FROZEN_AFTER_FOCUS_MS);

  expect(mockReportHandledFailure).not.toHaveBeenCalled();
});

test('a check timer that fires far too late means the JS thread stalled, which is not a freeze', async () => {
  const navigation = fakeNavigation();
  const { rerenderAsync } = await renderAsync(<Screen frozen={false} navigation={navigation} />);
  await rerenderAsync(<Screen frozen navigation={navigation} />);

  await act(async () => navigation.emitFocus());
  mockNow += 5000;
  await advance(FROZEN_AFTER_FOCUS_MS);

  expect(mockReportHandledFailure).not.toHaveBeenCalled();
});

function SlowContent(): React.ReactElement {
  mockNow += SLOW_SCREEN_MS + 200;
  return <Text>slow</Text>;
}

test('the first page of a cold start is startup cost, not a slow page', async () => {
  const navigation = fakeNavigation();
  await renderAsync(probeScreenLayout({ route: { name: 'index' }, navigation, children: <SlowContent /> }));

  expect(mockRecordMetric).not.toHaveBeenCalled();
  expect(mockReportHandledFailure).not.toHaveBeenCalled();
});

test('a page whose first commit takes over a second is recorded and reported by route template', async () => {
  const navigation = fakeNavigation();
  const startup = await renderAsync(probeScreenLayout({ route: { name: 'index' }, navigation, children: <Text>home</Text> }));
  await startup.unmountAsync();
  await renderAsync(probeScreenLayout({ route: { name: 'circle/[id]' }, navigation, children: <SlowContent /> }));

  expect(mockRecordMetric).toHaveBeenCalledWith('screen.first_commit.duration', SLOW_SCREEN_MS + 200);
  expect(mockReportHandledFailure).toHaveBeenCalledWith('render', 'slowScreen', expect.any(Error), {
    page: 'circle/[id]',
    durationMs: SLOW_SCREEN_MS + 200,
    // fingerprint 只收 [A-Za-z0-9_.-]。
    code: 'circle.id',
  });
});

test('a navigator wrapper does not time its first commit (its pages do)', async () => {
  const navigation = fakeNavigation();
  await renderAsync(probeNavigatorLayout({ route: { name: '(tabs)' }, navigation, children: <SlowContent /> }));

  expect(mockRecordMetric).not.toHaveBeenCalled();
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
