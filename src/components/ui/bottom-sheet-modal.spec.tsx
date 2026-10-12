import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PanResponder, Text } from 'react-native';
import { BottomSheetModal } from './bottom-sheet-modal';

jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});

type MoveHandler = (event: unknown, state: { dx: number; dy: number; y0: number }) => boolean;

let onMoveShouldSet: MoveHandler;

const createSpy = jest
  .spyOn(PanResponder, 'create')
  .mockImplementation((config) => {
    onMoveShouldSet = config.onMoveShouldSetPanResponder as unknown as MoveHandler;
    return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
  });

afterAll(() => {
  createSpy.mockRestore();
});

function renderSheetAt(top: number) {
  render(
    <BottomSheetModal visible onClose={jest.fn()}>
      <Text>content</Text>
    </BottomSheetModal>,
  );
  fireEvent(screen.getByTestId('bottom-sheet-content'), 'layout', {
    nativeEvent: { layout: { x: 0, y: top, width: 390, height: 400 } },
  });
}

test('a downward drag that starts on the sheet header claims the dismiss gesture', () => {
  renderSheetAt(400);
  expect(onMoveShouldSet({}, { dx: 0, dy: 20, y0: 420 })).toBe(true);
});

test('a downward drag inside the sheet body is left to child scroll views', () => {
  renderSheetAt(400);
  expect(onMoveShouldSet({}, { dx: 0, dy: 120, y0: 600 })).toBe(false);
});

test('horizontal or upward drags on the header are not treated as dismiss', () => {
  renderSheetAt(400);
  expect(onMoveShouldSet({}, { dx: 40, dy: 10, y0: 420 })).toBe(false);
  expect(onMoveShouldSet({}, { dx: 0, dy: -20, y0: 420 })).toBe(false);
});
