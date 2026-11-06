import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ClearHistoryDialog } from './ClearHistoryDialog';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/floating-modal', () => ({
  FloatingModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? children : null),
}));

test('confirming without ticking only clears my side', () => {
  const onConfirm = jest.fn();
  render(<ClearHistoryDialog visible onCancel={jest.fn()} onConfirm={onConfirm} />);
  fireEvent.press(screen.getByText('common.confirm'));
  expect(onConfirm).toHaveBeenCalledWith(false);
});

test('ticking 双向清空 asks for the other side too', () => {
  const onConfirm = jest.fn();
  render(<ClearHistoryDialog visible onCancel={jest.fn()} onConfirm={onConfirm} />);
  fireEvent.press(screen.getByRole('checkbox'));
  expect(screen.getByRole('checkbox').props.accessibilityState.checked).toBe(true);
  fireEvent.press(screen.getByText('common.confirm'));
  expect(onConfirm).toHaveBeenCalledWith(true);
});

test('cancel does nothing', () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  render(<ClearHistoryDialog visible onCancel={onCancel} onConfirm={onConfirm} />);
  fireEvent.press(screen.getByText('common.cancel'));
  expect(onCancel).toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});
