import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, PanResponder, Text } from 'react-native';
import { BottomSheetModal } from './bottom-sheet-modal';

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

afterAll(() => {
  createSpy.mockRestore();
  timingSpy.mockRestore();
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
  drag(420, 120);
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
