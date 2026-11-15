import React, { Profiler, useState } from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import { Freeze } from 'react-freeze';

// 回归(software-mansion/react-freeze#44,上游修复 PR #42 未合并,见 patches/react-freeze+1.0.4.patch):
// react-freeze 1.0.4 冻结时抛一个永不完成的 thenable。React 19.1 起,两个已显示占位的冻结边界
// 各自被一次更新碰到后,会互相轮换 retry lane,一次接一次地渲染提交、永不停止。JS 线程被占满,
// 计时器和网络回调都排不上队(笔记「完成」的 200ms 返回定时器就是这样饿死的),点一下屏幕才打断。
// 我们全 App 开了 freezeOnBlur,后台 tab 和栈里被盖住的页面同时冻结,很容易凑出两个。
// 真机采样:每秒约 24 次提交,completeRoot 自耗 36%,连卡 6～12 秒。

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

type Harness = {
  update: Record<'a' | 'b', () => void>;
  setFrozen: (frozen: boolean) => void;
  commits: number;
};

function createHarness(): { harness: Harness; App: React.FC } {
  const harness: Harness = {
    update: { a: () => {}, b: () => {} },
    setFrozen: () => {},
    commits: 0,
  };

  function Screen({ name, frozen }: { name: 'a' | 'b'; frozen: boolean }) {
    const [tick, setTick] = useState(0);
    harness.update[name] = () => setTick((n) => n + 1);
    return (
      <Freeze freeze={frozen}>
        <View testID={`screen-${name}`} accessibilityValue={{ now: tick }} />
      </Freeze>
    );
  }

  const App: React.FC = () => {
    const [frozen, setFrozen] = useState(false);
    harness.setFrozen = setFrozen;
    return (
      <Profiler
        id="app"
        onRender={() => {
          harness.commits += 1;
        }}
      >
        <Screen name="a" frozen={frozen} />
        <Screen name="b" frozen={frozen} />
      </Profiler>
    );
  };

  return { harness, App };
}

let previousActEnvironment: unknown;

beforeEach(() => {
  // 循环靠 Scheduler 的真实任务推进;act() 会自己把它们排空,看不出循环。
  previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown })
    .IS_REACT_ACT_ENVIRONMENT;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT = false;
});

afterEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT =
    previousActEnvironment;
});

test('two frozen screens reached by updates in turn settle instead of committing forever', async () => {
  const { harness, App } = createHarness();
  const { unmount } = render(<App />);
  try {
    await wait(20);
    harness.setFrozen(true);
    await wait(20);

    // React 在占位提交后会把 retry 压 300ms,循环要几轮才起得来。
    for (let round = 1; round <= 12; round += 1) {
      harness.update.a();
      await wait(0);
      harness.update.b();
      harness.commits = 0;
      await wait(100);
      expect(harness.commits).toBeLessThan(10);
    }
  } finally {
    unmount();
  }
});

test('a thawed screen shows its latest state right away', async () => {
  const { harness, App } = createHarness();
  const { getByTestId, unmount } = render(<App />);
  try {
    await wait(20);
    harness.setFrozen(true);
    await wait(20);
    harness.update.a();
    await wait(20);

    harness.setFrozen(false);
    await wait(20);

    expect(getByTestId('screen-a').props.accessibilityValue).toEqual({ now: 1 });
  } finally {
    unmount();
  }
});
