import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, Text } from 'react-native';
import { FloatingModal } from './floating-modal';

jest.mock('@/components/app/dialog-overlay', () => ({
  DialogOverlay: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    (visible ? children : null),
}));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({
  KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => children,
}));

function pressBackdrop() {
  // 居中容器本身就是可点的遮罩区域,卡片之外的点击落在它上面。
  fireEvent.press(screen.getByTestId('floating-modal-backdrop'));
}

function renderModal(closeOnBackdropPress = true) {
  const onClose = jest.fn();
  render(
    <FloatingModal visible onClose={onClose} closeOnBackdropPress={closeOnBackdropPress}>
      <Text>内容</Text>
    </FloatingModal>,
  );
  return onClose;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('tapping outside with the keyboard open only dismisses the keyboard', () => {
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  const onClose = renderModal();
  pressBackdrop();
  expect(dismiss).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test('tapping outside with the keyboard closed closes the dialog', () => {
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  const onClose = renderModal();
  pressBackdrop();
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a dialog that opts out of backdrop closing stays open', () => {
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  const onClose = renderModal(false);
  pressBackdrop();
  expect(onClose).not.toHaveBeenCalled();
});
