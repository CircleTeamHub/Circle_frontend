import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Animated, PanResponder } from 'react-native';
import { ZoomableImage } from './zoomable-image';

// 手势逻辑跑在 jest-expo 的**原生** preset 下 —— 手机端走的就是这条 PanResponder
// 路径（web 只额外加了滚轮）。这里直接把 PanResponder 收到的回调抓出来喂事件，
// 验证捏合 / 双击 / 长按 / 让位翻页四件事在原生侧成立。
jest.mock('expo-image', () => {
  const { View: RNView } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: (props: object) => <RNView testID="zoomable-image" {...props} /> };
});

type Handlers = {
  onPanResponderStart: (event: unknown, state: unknown) => void;
  onPanResponderEnd: (event: unknown, state: unknown) => void;
  onPanResponderTerminate: () => void;
  onMoveShouldSetPanResponder: (event: unknown, state: unknown) => boolean;
  onPanResponderTerminationRequest: () => boolean;
  onPanResponderGrant: (event: unknown, state: unknown) => void;
  onPanResponderMove: (event: unknown, state: unknown) => void;
  onPanResponderRelease: (event: unknown, state: unknown) => void;
};

let captured: Handlers;
const createNativeResponder = PanResponder.create;

const captureHandlers = (config: Parameters<typeof PanResponder.create>[0]) => {
  captured = config as unknown as Handlers;
  return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
};

const createSpy = jest
  .spyOn(PanResponder, 'create')
  .mockImplementation(captureHandlers);

function touchEvent(points: { pageX: number; pageY: number; locationX?: number; locationY?: number }[], location = {}) {
  return {
    nativeEvent: {
      touches: points.map((point) => ({ locationX: point.pageX, locationY: point.pageY, ...point })),
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
  createSpy.mockImplementation(captureHandlers);
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

test('a downward swipe at 1x requests dismissal after the threshold', () => {
  const onSwipeDown = jest.fn();
  renderImage({ onSwipeDown });

  act(() => {
    captured.onPanResponderGrant(
      touchEvent([{ pageX: 150, pageY: 120 }]),
      gesture(),
    );
    captured.onPanResponderMove(
      touchEvent([{ pageX: 150, pageY: 240 }]),
      gesture(0, 120),
    );
    captured.onPanResponderRelease(
      touchEvent([{ pageX: 150, pageY: 240 }]),
      { dx: 0, dy: 120, vy: 0 },
    );
  });

  expect(onSwipeDown).toHaveBeenCalledTimes(1);
});

test('a downward drag locks the pager through touch end and unlocks after release', () => {
  const onZoomedChange = jest.fn();
  const onSwipeDown = jest.fn();
  renderImage({ onZoomedChange, onSwipeDown });
  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 150, pageY: 120 }]), gesture());
    captured.onPanResponderMove(touchEvent([{ pageX: 155, pageY: 240 }]), gesture(5, 120));
  });
  expect(transformValues()[1]).toBe(120);
  expect(onZoomedChange).toHaveBeenLastCalledWith(true);
  expect(captured.onPanResponderTerminationRequest()).toBe(false);

  act(() => captured.onPanResponderEnd(touchEvent([]), gesture(5, 120)));
  expect(captured.onPanResponderTerminationRequest()).toBe(false);
  act(() => captured.onPanResponderRelease(touchEvent([]), { dx: 5, dy: 120, vy: 0 }));
  expect(onSwipeDown).toHaveBeenCalledTimes(1);
  expect(onZoomedChange).toHaveBeenLastCalledWith(false);
});

test('keeps native swipe distance when the viewer rerenders its paging callback', () => {
  createSpy.mockImplementation(createNativeResponder);
  const onSwipeDown = jest.fn();
  const props = { uri: 'a.jpg', width: 300, height: 300, active: true, onSwipeDown };
  const view = render(<ZoomableImage {...props} onZoomedChange={() => {}} />);
  const root = () => screen.UNSAFE_root.findAll(
    (node: { props: Record<string, unknown> }) => typeof node.props.onResponderGrant === 'function',
  )[0];
  const nativeEvent = (previousY: number, y: number, time: number) => ({
    ...touchEvent([{ pageX: 150, pageY: y }]),
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: time,
      touchBank: [{
        touchActive: true,
        startPageX: 150, startPageY: 120, startTimeStamp: 1,
        previousPageX: 150, previousPageY: previousY, previousTimeStamp: time - 10,
        currentPageX: 150, currentPageY: y, currentTimeStamp: time,
      }],
    },
  });
  act(() => {
    root().props.onStartShouldSetResponderCapture(nativeEvent(120, 120, 1));
    root().props.onResponderGrant(nativeEvent(120, 120, 1));
    root().props.onResponderMove(nativeEvent(120, 190, 701));
  });
  view.rerender(<ZoomableImage {...props} onZoomedChange={() => {}} />);
  act(() => {
    root().props.onResponderMove(nativeEvent(190, 240, 1201));
    root().props.onResponderRelease(nativeEvent(240, 240, 1202));
  });
  expect(onSwipeDown).toHaveBeenCalledTimes(1);
});

test('horizontal drags with downward drift do not move or dismiss the image', () => {
  const onSwipeDown = jest.fn();
  const onZoomedChange = jest.fn();
  renderImage({ onSwipeDown, onZoomedChange });
  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 150, pageY: 120 }]), gesture());
    captured.onPanResponderMove(touchEvent([{ pageX: 350, pageY: 220 }]), gesture(200, 100));
  });
  expect(transformValues()[1]).toBe(0);
  expect(captured.onPanResponderTerminationRequest()).toBe(true);
  act(() => captured.onPanResponderRelease(touchEvent([]), { dx: 200, dy: 100, vy: 0 }));
  expect(onSwipeDown).not.toHaveBeenCalled();
  expect(onZoomedChange).not.toHaveBeenCalledWith(true);
});

test.each(['release', 'terminate', 'deactivate'])(
  'a short downward drag resets and unlocks paging on %s',
  (ending) => {
    const onSwipeDown = jest.fn();
    const onTap = jest.fn();
    const onZoomedChange = jest.fn();
    const props = { uri: 'a.jpg', width: 300, height: 300, onSwipeDown, onTap, onZoomedChange };
    const view = render(<ZoomableImage {...props} active />);
    act(() => {
      captured.onPanResponderGrant(touchEvent([{ pageX: 150, pageY: 120 }]), gesture());
      captured.onPanResponderMove(touchEvent([{ pageX: 150, pageY: 150 }]), gesture(0, 30));
    });
    expect(onZoomedChange).toHaveBeenLastCalledWith(true);
    act(() => {
      if (ending === 'release') captured.onPanResponderRelease(touchEvent([]), { dx: 0, dy: 30, vy: 0 });
      else if (ending === 'terminate') captured.onPanResponderTerminate();
      else view.rerender(<ZoomableImage {...props} active={false} />);
      jest.advanceTimersByTime(2000);
    });
    expect(onZoomedChange).toHaveBeenLastCalledWith(false);
    expect(transformValues()[1]).toBeCloseTo(0);
    expect(onSwipeDown).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  },
);

test('a tap with a few pixels of downward jitter still counts as a tap', () => {
  const onTap = jest.fn();
  const onSwipeDown = jest.fn();
  renderImage({ onTap, onSwipeDown });

  act(() => {
    captured.onPanResponderGrant(
      touchEvent([{ pageX: 150, pageY: 120 }]),
      gesture(),
    );
    captured.onPanResponderMove(
      touchEvent([{ pageX: 151, pageY: 123 }]),
      gesture(1, 3),
    );
    captured.onPanResponderRelease(
      touchEvent([{ pageX: 151, pageY: 123 }]),
      { dx: 1, dy: 3, vy: 0 },
    );
    jest.advanceTimersByTime(300);
  });

  expect(onSwipeDown).not.toHaveBeenCalled();
  expect(onTap).toHaveBeenCalledTimes(1);
});

test('releasing a pinch that ends at 1x with downward travel does not dismiss', () => {
  const onSwipeDown = jest.fn();
  renderImage({ onSwipeDown });

  act(() => {
    captured.onPanResponderGrant(
      touchEvent([{ pageX: 100, pageY: 100 }, { pageX: 200, pageY: 100 }]),
      gesture(),
    );
    captured.onPanResponderMove(
      touchEvent([{ pageX: 100, pageY: 100 }, { pageX: 200, pageY: 100 }]),
      gesture(),
    );
    captured.onPanResponderMove(
      touchEvent([{ pageX: 100, pageY: 220 }, { pageX: 200, pageY: 220 }]),
      gesture(0, 120),
    );
    captured.onPanResponderRelease(
      touchEvent([]),
      { dx: 0, dy: 120, vy: 0 },
    );
  });

  expect(onSwipeDown).not.toHaveBeenCalled();
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

function transformValues() {
  const transforms = screen.UNSAFE_getByType(Animated.View).props.style[1].transform;
  return transforms.map((transform: Record<string, Animated.Value>) =>
    (Object.values(transform)[0] as Animated.Value & { __getValue(): number }).__getValue(),
  );
}

test('locks paging as soon as a second finger lands, even before zoom exceeds 1x', () => {
  const onZoomedChange = jest.fn();
  renderImage({ onZoomedChange });
  act(() => captured.onPanResponderGrant(touchEvent([
    { pageX: 100, pageY: 150 }, { pageX: 200, pageY: 150 },
  ]), gesture()));
  expect(onZoomedChange).toHaveBeenLastCalledWith(true);
  expect(captured.onPanResponderTerminationRequest()).toBe(false);
  act(() => captured.onPanResponderRelease(touchEvent([]), gesture()));
  expect(onZoomedChange).toHaveBeenLastCalledWith(false);
});

test('preserves the root-local pinch focus after a prefetched page changes its window position', () => {
  renderImage();
  const pinch = (spread: number) => touchEvent([
    { pageX: 800 + 100 - spread, pageY: 150, locationX: 100 - spread, locationY: 150 },
    { pageX: 800 + 100 + spread, pageY: 150, locationX: 100 + spread, locationY: 150 },
  ]);
  act(() => {
    captured.onPanResponderGrant(pinch(25), gesture());
    captured.onPanResponderMove(pinch(25), gesture());
    captured.onPanResponderMove(pinch(50), gesture());
  });
  expect(transformValues()).toEqual([50, 0, 2]);
  expect(screen.UNSAFE_getByType(Animated.View).props.pointerEvents).toBe('none');
});

test('contains narrow images and reclamps immediately when intrinsic dimensions load', () => {
  renderImage();
  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 100, pageY: 150 }, { pageX: 200, pageY: 150 }]), gesture());
    captured.onPanResponderMove(touchEvent([{ pageX: 100, pageY: 150 }, { pageX: 200, pageY: 150 }]), gesture());
    captured.onPanResponderMove(touchEvent([{ pageX: 150, pageY: 150 }, { pageX: 350, pageY: 150 }]), gesture(100));
  });
  act(() => screen.getByTestId('zoomable-image').props.onLoad({ source: { width: 100, height: 300 } }));
  expect(transformValues()).toEqual([0, 0, 2]);
  act(() => {
    captured.onPanResponderRelease(touchEvent([]), gesture());
    captured.onPanResponderGrant(touchEvent([{ pageX: 100, pageY: 150 }]), gesture());
    captured.onPanResponderMove(touchEvent([{ pageX: 200, pageY: 150 }]), gesture(100));
  });
  expect(transformValues()).toEqual([0, 0, 2]);
  expect(screen.getByTestId('zoomable-image').props.enforceEarlyResizing).toBe(true);
});

test('continues from the pinch translation when one finger remains', () => {
  renderImage();
  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 75, pageY: 150 }, { pageX: 125, pageY: 150 }]), gesture());
    captured.onPanResponderMove(touchEvent([{ pageX: 75, pageY: 150 }, { pageX: 125, pageY: 150 }]), gesture());
    captured.onPanResponderMove(touchEvent([{ pageX: 50, pageY: 150 }, { pageX: 150, pageY: 150 }]), gesture());
    captured.onPanResponderEnd(touchEvent([{ pageX: 150, pageY: 150 }]), gesture());
    captured.onPanResponderMove(touchEvent([{ pageX: 160, pageY: 150 }]), gesture(80));
  });
  expect(transformValues()).toEqual([60, 0, 2]);
});

test('a drag cancels a pending single tap instead of closing while moving', () => {
  const onTap = jest.fn();
  renderImage({ onTap });
  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 100, pageY: 150 }]), gesture());
    captured.onPanResponderRelease(touchEvent([]), gesture());
    captured.onPanResponderGrant(touchEvent([{ pageX: 100, pageY: 150 }]), gesture());
    captured.onPanResponderMove(touchEvent([{ pageX: 130, pageY: 150 }]), gesture(30));
    jest.advanceTimersByTime(300);
  });
  expect(onTap).not.toHaveBeenCalled();
});

test('deactivating a page cancels pending taps and long presses', () => {
  const onTap = jest.fn();
  const onLongPress = jest.fn();
  const props = { uri: 'a.jpg', width: 300, height: 300, onTap, onLongPress };
  const view = render(<ZoomableImage {...props} active />);
  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 100, pageY: 150 }]), gesture());
    captured.onPanResponderRelease(touchEvent([]), gesture());
    captured.onPanResponderGrant(touchEvent([{ pageX: 100, pageY: 150 }]), gesture());
  });
  view.rerender(<ZoomableImage {...props} active={false} />);
  act(() => jest.advanceTimersByTime(600));
  expect(onTap).not.toHaveBeenCalled();
  expect(onLongPress).not.toHaveBeenCalled();
});

test('a second press cancels the pending tap while waiting for a long press', () => {
  const onTap = jest.fn();
  const onLongPress = jest.fn();
  renderImage({ onTap, onLongPress });
  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 100, pageY: 150 }]), gesture());
    captured.onPanResponderRelease(touchEvent([]), gesture());
    captured.onPanResponderGrant(touchEvent([{ pageX: 100, pageY: 150 }]), gesture());
    jest.advanceTimersByTime(600);
  });
  expect(onTap).not.toHaveBeenCalled();
  expect(onLongPress).toHaveBeenCalledTimes(1);
});

test('a second finger cancels a pending tap and releases the paging lock on termination', () => {
  const onTap = jest.fn();
  const onZoomedChange = jest.fn();
  renderImage({ onTap, onZoomedChange });
  act(() => {
    captured.onPanResponderGrant(touchEvent([{ pageX: 100, pageY: 150 }]), gesture());
    captured.onPanResponderRelease(touchEvent([]), gesture());
    captured.onPanResponderGrant(touchEvent([{ pageX: 100, pageY: 150 }]), gesture());
    captured.onPanResponderStart(touchEvent([{ pageX: 100, pageY: 150 }, { pageX: 200, pageY: 150 }]), gesture());
    jest.advanceTimersByTime(600);
  });
  expect(onTap).not.toHaveBeenCalled();
  expect(onZoomedChange).toHaveBeenLastCalledWith(true);
  act(() => captured.onPanResponderTerminate());
  expect(onZoomedChange).toHaveBeenLastCalledWith(false);
});

test('double-tap reset and a subsequent short downward swipe share the JS animation driver', () => {
  const timing = jest.spyOn(Animated, 'timing');
  const spring = jest.spyOn(Animated, 'spring');
  renderImage();
  act(() => {
    for (let i = 0; i < 4; i++) {
      captured.onPanResponderGrant(touchEvent([{ pageX: 150, pageY: 150 }]), gesture());
      captured.onPanResponderRelease(touchEvent([]), gesture());
    }
    captured.onPanResponderGrant(touchEvent([{ pageX: 150, pageY: 150 }]), gesture());
    captured.onPanResponderMove(touchEvent([{ pageX: 150, pageY: 180 }]), gesture(0, 30));
    captured.onPanResponderRelease(touchEvent([]), { dx: 0, dy: 30, vy: 0 });
    jest.advanceTimersByTime(2000);
  });
  expect(timing).toHaveBeenCalled();
  expect(timing.mock.calls.every(([, config]) => config.useNativeDriver === false)).toBe(true);
  expect(spring).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0, useNativeDriver: false }));
  expect(transformValues()[1]).toBeCloseTo(0);
  timing.mockRestore();
  spring.mockRestore();
});
