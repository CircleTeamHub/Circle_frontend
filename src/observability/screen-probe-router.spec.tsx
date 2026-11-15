import React from 'react';
import { Text } from 'react-native';
import { router, type Href } from 'expo-router';
import Stack from 'expo-router/stack';
import Tabs from 'expo-router/tabs';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { probeNavigatorLayout, probeScreenLayout } from './screen-probe';

const mockRecordMetric = jest.fn();
jest.mock('./metrics', () => ({
  recordMetric: (...args: unknown[]) => mockRecordMetric(...args),
}));

// 集成：探针经 screenLayout 挂在 expo-router 的 Stack / Tabs 上，确实包住了每个页面——
// 每个叶子页面首次提交都记了耗时，装着子导航器的那层不记。
test('expo-router stacks and tabs wrap their pages with the probe', async () => {
  renderRouter(
    {
      _layout: () => <Tabs screenLayout={probeNavigatorLayout} />,
      '(home)/_layout': () => <Stack screenLayout={probeScreenLayout} />,
      '(home)/index': () => <Text>home</Text>,
      '(home)/detail': () => <Text>detail</Text>,
    },
    { initialUrl: '/' },
  );
  expect(await screen.findByText('home')).toBeTruthy();
  expect(mockRecordMetric).toHaveBeenCalledTimes(1);

  // 测试里临时搭的路由不在 App 的类型化路由表里。
  act(() => router.push('/detail' as unknown as Href));
  expect(await screen.findByText('detail')).toBeTruthy();
  expect(mockRecordMetric).toHaveBeenCalledTimes(2);
  expect(mockRecordMetric).toHaveBeenLastCalledWith('screen.first_commit.duration', expect.any(Number));
});
