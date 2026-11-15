import React, { memo, useState } from 'react';
import { Text, View } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import {
  COMMIT_STORM_RATE,
  COMMIT_STORM_SECONDS,
  createCommitStormDetector,
  findHotComponents,
  snapshotFibers,
  type CommitStorm,
} from './commit-storm-detector';

type FiberNode = { return: FiberNode | null; stateNode: unknown };

/** 渲染器交给 onCommitFiberRoot 的就是 FiberRoot：从任意 fiber 往上走到 HostRoot 取 stateNode。 */
function committedRoot(): unknown {
  let fiber = (screen.UNSAFE_root as unknown as { _fiber: FiberNode })._fiber;
  while (fiber.return) fiber = fiber.return;
  return fiber.stateNode;
}

describe('findHotComponents', () => {
  test('names the component whose state changed, not the parents React only cloned on the way down', () => {
    let bump = () => {};
    function Ticker() {
      const [count, setCount] = useState(0);
      bump = () => setCount((value) => value + 1);
      return <Text>{count}</Text>;
    }
    const StaticRow = memo(function StaticRow() {
      return (
        <View>
          <Text>static</Text>
        </View>
      );
    });
    function ChatScreen() {
      return (
        <View>
          <StaticRow />
          <Ticker />
        </View>
      );
    }

    render(<ChatScreen />);
    const before = snapshotFibers(committedRoot());
    act(() => bump());

    expect(findHotComponents(before, committedRoot())).toEqual(['ChatScreen>Ticker']);
  });

  test('a commit that changed nothing new reports no component', () => {
    function Idle() {
      return <Text>idle</Text>;
    }
    render(<Idle />);
    const root = committedRoot();

    expect(findHotComponents(snapshotFibers(root), root)).toEqual([]);
  });
});

describe('createCommitStormDetector', () => {
  const fakeRoot = { current: { tag: 3, child: null } };

  function setup({ active = true, keyboard = false } = {}) {
    let clock = 1_000_000;
    const storms: CommitStorm[] = [];
    const detector = createCommitStormDetector({
      now: () => clock,
      isAppActive: () => active,
      isKeyboardVisible: () => keyboard,
      onStorm: (storm) => storms.push(storm),
    });
    const commitFor = (seconds: number, perSecond: number) => {
      const gap = 1000 / perSecond;
      for (let index = 0; index < seconds * perSecond; index += 1) {
        detector.onCommit(fakeRoot);
        clock += gap;
      }
    };
    const advance = (ms: number) => {
      clock += ms;
    };
    return { detector, storms, commitFor, advance };
  }

  test(`reports once after ${COMMIT_STORM_SECONDS}s of ≥${COMMIT_STORM_RATE} commits a second with nobody touching`, () => {
    const { storms, commitFor } = setup();
    commitFor(COMMIT_STORM_SECONDS + 3, 24);

    expect(storms).toHaveLength(1);
    expect(storms[0].commitsPerSecond).toBeGreaterThanOrEqual(20);
    expect(storms[0].durationMs).toBeGreaterThanOrEqual((COMMIT_STORM_SECONDS - 1) * 1000);
    expect(storms[0].components).toEqual([]);
  });

  test('hot components are only diffed against the next commit of the same root', () => {
    const { detector, storms, commitFor } = setup();
    // 最后一秒刚好第 15 次提交时判定成风暴，等下一次提交来取组件名。
    commitFor(COMMIT_STORM_SECONDS - 1, 20); // 每 50ms 一次，秒界对齐
    commitFor(1, COMMIT_STORM_RATE);
    expect(storms).toHaveLength(0);
    detector.onCommit({ current: { tag: 3, child: null } });
    expect(storms).toHaveLength(0);

    detector.onCommit(fakeRoot);
    expect(storms).toHaveLength(1);
  });

  test('a busy UI just under the rate never reports', () => {
    const { storms, commitFor } = setup();
    commitFor(60, COMMIT_STORM_RATE - 1);

    expect(storms).toHaveLength(0);
  });

  test('commits while a finger is down, or during the fling right after, are the user scrolling', () => {
    const { detector, storms, commitFor, advance } = setup();
    detector.onTouch(1);
    commitFor(8, 30);
    expect(storms).toHaveLength(0);

    detector.onTouch(0);
    advance(500);
    commitFor(1, 30);
    expect(storms).toHaveLength(0);
  });

  test('a native scroll that took the touch over (cancel, no end) keeps masking while the list scrolls', () => {
    const { detector, storms, commitFor } = setup();
    detector.onTouch(1);
    detector.onTouchCancel();
    commitFor(9, 20);

    expect(storms).toHaveLength(0);
  });

  test('a touch whose end never arrived stops masking storms after 10 seconds', () => {
    const { detector, storms, commitFor } = setup();
    detector.onTouch(1);
    commitFor(10 + COMMIT_STORM_SECONDS + 2, 24);

    expect(storms).toHaveLength(1);
  });

  // 系统键盘的按键不经过根视图：快速打字每键 2～3 次提交，只看触摸会误报。
  test('fast typing with the keyboard up is not a storm', () => {
    const { storms, commitFor } = setup({ keyboard: true });
    commitFor(20, 24);

    expect(storms).toHaveLength(0);
  });

  test('commits in the background are not counted', () => {
    const { storms, commitFor } = setup({ active: false });
    commitFor(20, 30);

    expect(storms).toHaveLength(0);
  });

  test('a storm that keeps going is reported once per ten minutes', () => {
    const { storms, commitFor } = setup();
    commitFor(9 * 60, 20);
    expect(storms).toHaveLength(1);

    commitFor(2 * 60, 20);
    expect(storms).toHaveLength(2);
  });
});
