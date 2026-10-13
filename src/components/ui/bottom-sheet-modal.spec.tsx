import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, PanResponder, Text } from 'react-native';
import { BottomSheetFlatList, BottomSheetModal } from './bottom-sheet-modal';

jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});

type Gesture = { dx: number; dy: number; vy: number; y0: number };
type Handlers = {
  onMoveShouldSetPanResponder: (event: unknown, gesture: Gesture) => boolean;
  onMoveShouldSetPanResponderCapture: (event: unknown, gesture: Gesture) => boolean;
  onPanResponderGrant: (event: unknown, gesture: Gesture) => void;
  onPanResponderMove: (event: unknown, gesture: Gesture) => void;
  onPanResponderRelease: (event: unknown, gesture: Gesture) => void;
};

let handlers: Handlers;

const createSpy = jest
  .spyOn(PanResponder, 'create')
  .mockImplementation((config) => {
    handlers = config as unknown as Handlers;
    return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
  });
// Run the dismiss animation's completion synchronously.
const timingSpy = jest.spyOn(Animated, 'timing').mockImplementation(
  () =>
    ({
      start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
    }) as Animated.CompositeAnimation,
);

const springSpy = jest.spyOn(Animated, 'spring').mockImplementation(
  () => ({ start: () => undefined }) as unknown as Animated.CompositeAnimation,
);

afterAll(() => {
  createSpy.mockRestore();
  timingSpy.mockRestore();
  springSpy.mockRestore();
});

function renderSheetAt(top: number, onClose = jest.fn()) {
  render(
    <BottomSheetModal visible onClose={onClose}>
      <Text>content</Text>
    </BottomSheetModal>,
  );
  fireEvent(screen.getByTestId('bottom-sheet-content'), 'layout', {
    nativeEvent: { layout: { x: 0, y: top, width: 390, height: 400 } },
  });
  return onClose;
}

/** Drive the real handler sequence the responder system would call. */
function drag(y0: number, dy: number, vy = 0) {
  act(() => {
    handlers.onPanResponderGrant({}, { dx: 0, dy: 0, vy: 0, y0 });
    handlers.onPanResponderMove({}, { dx: 0, dy, vy, y0 });
    handlers.onPanResponderRelease({}, { dx: 0, dy, vy, y0 });
  });
}

test('a downward drag from the header claims the gesture and dismisses the sheet', () => {
  const onClose = renderSheetAt(400);
  expect(handlers.onMoveShouldSetPanResponder({}, { dx: 0, dy: 20, vy: 0, y0: 420 })).toBe(true);
  drag(420, 200);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a drag that starts in the body never moves or dismisses the sheet', () => {
  const onClose = renderSheetAt(400);
  expect(handlers.onMoveShouldSetPanResponder({}, { dx: 0, dy: 120, vy: 0, y0: 600 })).toBe(false);
  // Even when the sheet root already owns the responder from touch start
  // (backdrop suppression), body-originated gestures are ignored.
  drag(600, 300, 3);
  expect(onClose).not.toHaveBeenCalled();
});

test('horizontal or upward drags on the header are not treated as dismiss', () => {
  renderSheetAt(400);
  expect(handlers.onMoveShouldSetPanResponder({}, { dx: 40, dy: 10, vy: 0, y0: 420 })).toBe(false);
  expect(handlers.onMoveShouldSetPanResponder({}, { dx: 0, dy: -20, vy: 0, y0: 420 })).toBe(false);
});

test('a short or gentle header drag springs back instead of dismissing', () => {
  const onClose = renderSheetAt(400);
  // 拖出 90pt 没过 120 的门槛；快甩但只拖出 30pt 也不算。
  drag(420, 100);
  drag(420, 40, 3);
  expect(onClose).not.toHaveBeenCalled();
});

function renderListSheetAt(top: number, onClose = jest.fn()) {
  render(
    <BottomSheetModal visible onClose={onClose}>
      <BottomSheetFlatList
        testID="sheet-list"
        data={['a', 'b']}
        keyExtractor={(item) => item}
        renderItem={({ item }) => <Text>{item}</Text>}
      />
    </BottomSheetModal>,
  );
  fireEvent(screen.getByTestId('bottom-sheet-content'), 'layout', {
    nativeEvent: { layout: { x: 0, y: top, width: 390, height: 400 } },
  });
  return onClose;
}

function scrollListTo(y: number) {
  fireEvent.scroll(screen.getByTestId('sheet-list'), {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height: 2000 },
      layoutMeasurement: { width: 390, height: 300 },
    },
  });
}

test('with its list at the top, a body drag pins the list and moves the sheet', () => {
  const onClose = renderListSheetAt(400);
  expect(handlers.onMoveShouldSetPanResponderCapture({}, { dx: 0, dy: 20, vy: 0, y0: 600 })).toBe(true);
  drag(600, 200);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('while its list is scrolled down, a body drag scrolls the list and leaves the sheet alone', () => {
  const onClose = renderListSheetAt(400);
  scrollListTo(240);
  expect(handlers.onMoveShouldSetPanResponderCapture({}, { dx: 0, dy: 40, vy: 0, y0: 600 })).toBe(false);
  drag(600, 300, 3);
  expect(onClose).not.toHaveBeenCalled();
  // 把手区域始终可拖。
  expect(handlers.onMoveShouldSetPanResponderCapture({}, { dx: 0, dy: 20, vy: 0, y0: 420 })).toBe(true);
});
