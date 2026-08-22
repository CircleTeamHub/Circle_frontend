import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { PanResponder } from 'react-native';
import { ZoomableImage } from './zoomable-image';

// 手势逻辑跑在 jest-expo 的**原生** preset 下 —— 手机端走的就是这条 PanResponder
// 路径（web 只额外加了滚轮）。这里直接把 PanResponder 收到的回调抓出来喂事件，
// 验证捏合 / 双击 / 长按 / 让位翻页四件事在原生侧成立。
jest.mock('expo-image', () => {
  const { View: RNView } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: () => <RNView testID="zoomable-image" /> };
});

type Handlers = {
  onMoveShouldSetPanResponder: (event: unknown, state: unknown) => boolean;
  onPanResponderTerminationRequest: () => boolean;
  onPanResponderGrant: (event: unknown, state: unknown) => void;
  onPanResponderMove: (event: unknown, state: unknown) => void;
  onPanResponderRelease: (event: unknown, state: unknown) => void;
};

let captured: Handlers;

const createSpy = jest
  .spyOn(PanResponder, 'create')
  .mockImplementation((config) => {
    captured = config as unknown as Handlers;
    return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
  });

function touchEvent(points: { pageX: number; pageY: number }[], location = {}) {
  return {
    nativeEvent: {
      touches: points,
      locationX: 100,
      locationY: 100,
      ...location,
    },
  };
}

const gesture = (dx = 0, dy = 0) => ({ dx, dy });

function renderImage(overrides: Partial<React.ComponentProps<typeof ZoomableImage>> = {}) {
  const props = {
    uri: 'https://example.test/a.png',
    width: 300,
    height: 300,
    active: true,
    ...overrides,
  };
  render(<ZoomableImage {...props} />);
  return props;
}

beforeEach(() => {
  createSpy.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('renders the image and wires a PanResponder on native', () => {
  renderImage();
  expect(screen.getByTestId('zoomable-image')).toBeTruthy();
  expect(captured.onMoveShouldSetPanResponder).toBeInstanceOf(Function);
});

test('at 1x a horizontal drag is left to the pager, and the pager may take over', () => {
  renderImage();

  // 未放大 + 单指横向移动 → 不拦截（外层 FlatList 负责翻页）。
  expect(
    captured.onMoveShouldSetPanResponder(
      touchEvent([{ pageX: 10, pageY: 10 }]),
      gesture(40, 2),
    ),
  ).toBe(false);
  // 且允许列表把手势抢走。
  expect(captured.onPanResponderTerminationRequest()).toBe(true);
});

test('a two-finger pinch zooms in and then keeps the gesture away from the pager', () => {
  const onZoomedChange = jest.fn();
  renderImage({ onZoomedChange });

  const twoFingers = (spread: number) =>
    touchEvent([
      { pageX: 100 - spread, pageY: 100 },
      { pageX: 100 + spread, pageY: 100 },
    ]);

  // 双指永远拦截。
  expect(
    captured.onMoveShouldSetPanResponder(twoFingers(50), gesture(0, 0)),
  ).toBe(true);

  act(() => {
    captured.onPanResponderGrant(twoFingers(50), gesture());
    captured.onPanResponderMove(twoFingers(50), gesture(0, 0)); // 记录基线
    captured.onPanResponderMove(twoFingers(100), gesture(0, 0)); // 张开一倍
  });

  expect(onZoomedChange).toHaveBeenCalledWith(true);
  // 放大后不再让位：列表拒绝交出手势，平移才不会变成翻页。
  expect(captured.onPanResponderTerminationRequest()).toBe(false);
});

test('a double tap zooms in, a second double tap resets', () => {
  const onZoomedChange = jest.fn();
  renderImage({ onZoomedChange });

  const tap = () => {
    act(() => {
      captured.onPanResponderGrant(touchEvent([{ pageX: 1, pageY: 1 }]), gesture());
      captured.onPanResponderRelease(
        touchEvent([{ pageX: 1, pageY: 1 }]),
        gesture(0, 0),
      );
    });
  };

  tap();
  tap();
  expect(onZoomedChange).toHaveBeenLastCalledWith(true);

  tap();
  tap();
  expect(onZoomedChange).toHaveBeenLastCalledWith(false);
});

test('a single tap closes only after the double-tap window passes', () => {
  const onTap = jest.fn();
  renderImage({ onTap });

  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 1, pageY: 1 }]), gesture());
    captured.onPanResponderRelease(
      touchEvent([{ pageX: 1, pageY: 1 }]),
      gesture(0, 0),
    );
  });
  expect(onTap).not.toHaveBeenCalled();

  act(() => {
    jest.advanceTimersByTime(300);
  });
  expect(onTap).toHaveBeenCalledTimes(1);
});

test('holding fires the long-press menu, and moving cancels it', () => {
  const onLongPress = jest.fn();
  renderImage({ onLongPress });

  // 按住不动 → 触发。
  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 1, pageY: 1 }]), gesture());
    jest.advanceTimersByTime(600);
  });
  expect(onLongPress).toHaveBeenCalledTimes(1);

  // 按住后移动 → 取消（这是拖拽，不是长按）。
  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 1, pageY: 1 }]), gesture());
    captured.onPanResponderMove(
      touchEvent([{ pageX: 40, pageY: 1 }]),
      gesture(40, 0),
    );
    jest.advanceTimersByTime(600);
  });
  expect(onLongPress).toHaveBeenCalledTimes(1);
});
