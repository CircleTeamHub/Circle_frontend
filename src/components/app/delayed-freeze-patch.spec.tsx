import React from 'react';
import { View } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import DelayedFreeze from 'react-native-screens/src/components/helpers/DelayedFreeze';

// 回归(react-native-screens#4518,上游修复 PR #4608 未合并,见 patches/react-native-screens+4.23.0.patch):
// tab 失焦→冻结;重新聚焦→立即解冻,但重置 freezeState 的 setTimeout(0) 还没跑;
// 这时又失焦(JS 忙时连着切两下 tab 就会这样),freezeState 还是旧的 true,于是在同一次提交里
// 直接冻结,没有那一次「宽限渲染」:activityState=0 永远到不了原生端。原生端两个 tab 都以为
// 自己在最上面,画面停在一个 tab 上,之后怎么点 tab 选中项会变、内容不变,也不会恢复。

function Probe({ activityState }: { activityState: number }) {
  return <View testID="screen" accessibilityValue={{ now: activityState }} />;
}

function renderScreen(freeze: boolean, activityState: number) {
  return (
    <DelayedFreeze freeze={freeze}>
      <Probe activityState={activityState} />
    </DelayedFreeze>
  );
}

function committedActivityState(): number | undefined {
  return screen.getByTestId('screen', { includeHiddenElements: true }).props.accessibilityValue?.now;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('a tab that blurs again before the unfreeze timer fires still gets its deactivation rendered', () => {
  const { rerender } = render(renderScreen(false, 2));

  // 失焦:先渲染出 0,计时器跑完后冻结。
  rerender(renderScreen(true, 0));
  act(() => {
    jest.runOnlyPendingTimers();
  });
  expect(committedActivityState()).toBe(0);

  // 重新聚焦:立即解冻并渲染出 2;重置计时器还没跑。
  rerender(renderScreen(false, 2));
  expect(committedActivityState()).toBe(2);

  // 计时器跑之前又失焦:必须先渲染出 0 再冻结。
  rerender(renderScreen(true, 0));
  expect(committedActivityState()).toBe(0);
});
