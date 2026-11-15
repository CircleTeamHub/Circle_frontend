import React from 'react';
import { Text } from 'react-native';
import { router, type Href } from 'expo-router';
import Stack from 'expo-router/stack';
import Tabs from 'expo-router/tabs';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { probeScreenLayout, SLOW_SCREEN_MS } from './screen-probe';

const mockRecordMetric = jest.fn();
const mockReportHandledFailure = jest.fn();
let mockNow = 0;
jest.mock('./metrics', () => ({
  recordMetric: (...args: unknown[]) => mockRecordMetric(...args),
}));
jest.mock('./report-failure', () => ({
  reportHandledFailure: (...args: unknown[]) => mockReportHandledFailure(...args),
  toStableCode: jest.requireActual('./report-failure').toStableCode,
}));
jest.mock('./http-diagnostics', () => ({
  diagnosticNow: () => mockNow,
}));

function SlowDetail(): React.ReactElement {
  mockNow += SLOW_SCREEN_MS + 200;
  return <Text>detail</Text>;
}

// 集成：探针经 screenLayout 挂在 expo-router 的叶子栈上，确实包住了每个页面；页面名里的栈
// 来自 expo-router 给导航器的 id（布局路径）。
test('an expo-router stack wraps its pages with the probe, named by layout path', async () => {
  renderRouter(
    {
      _layout: () => <Tabs />,
      '(home)/_layout': () => <Stack screenLayout={probeScreenLayout} />,
      '(home)/index': () => <Text>home</Text>,
      '(home)/detail': SlowDetail,
    },
    { initialUrl: '/' },
  );
  expect(await screen.findByText('home')).toBeTruthy();
  // 冷启动的第一个页面不计（启动耗时归 app start）。
  expect(mockRecordMetric).not.toHaveBeenCalled();

  // 测试里临时搭的路由不在 App 的类型化路由表里。
  act(() => router.push('/detail' as unknown as Href));
  expect(await screen.findByText('detail')).toBeTruthy();
  expect(mockRecordMetric).toHaveBeenCalledTimes(1);
  expect(mockReportHandledFailure).toHaveBeenCalledWith('render', 'slowScreen', expect.any(Error), {
    page: '/(home)/detail',
    durationMs: expect.any(Number),
    code: 'home.detail',
  });
});
