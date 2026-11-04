import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MessageSelectionToolbar } from './MessageSelectionToolbar';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text testID={`icon-${name}`}>{name}</Text>;
} }));
jest.mock('@/theme', () => ({
  useTheme: () => ({ colors: { background: '#f4f5f8', surface: '#fff', surfaceBorder: '#ddd', text: '#222', textSecondary: '#777', primary: '#6366f1', iconAccent: '#6366f1', danger: '#c43c48', warningText: '#9c650b', blue: '#397cec' } }),
  withAlpha: (value: string) => value,
}));

const props = () => ({ count: 3, bottomInset: 34, canSave: true, canForward: true, canCollect: true, progress: null,
  onSave: jest.fn(), onForward: jest.fn(), onCollect: jest.fn(), onDelete: jest.fn(), onCancel: jest.fn(),
});

test('four labeled icon actions invoke their own operation and cancel remains separate', () => {
  const actions = props();
  render(<MessageSelectionToolbar {...actions} />);
  for (const [label, callback] of [
    ['common.save', actions.onSave], ['chat.messageActions.forward', actions.onForward],
    ['chat.messageActions.collect', actions.onCollect], ['common.delete', actions.onDelete], ['common.cancel', actions.onCancel],
  ] as const) {
    fireEvent.press(screen.getByRole('button', { name: label }));
    expect(callback).toHaveBeenCalledTimes(1);
  }
  for (const icon of ['download-outline', 'arrow-redo-outline', 'star-outline', 'trash-outline']) expect(screen.getByTestId(`icon-${icon}`)).toBeTruthy();
});

test('unsupported actions and zero selection are disabled', () => {
  const actions = props();
  const rendered = render(<MessageSelectionToolbar {...actions} canSave={false} canForward={false} canCollect={false} />);
  for (const name of ['common.save', 'chat.messageActions.forward', 'chat.messageActions.collect']) expect(screen.getByRole('button', { name })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'common.delete' })).toBeEnabled();
  rendered.rerender(<MessageSelectionToolbar {...actions} count={0} />);
  expect(screen.getByRole('button', { name: 'common.delete' })).toBeDisabled();
});

test('a running operation exposes progress and prevents duplicate or conflicting actions', () => {
  const actions = props();
  render(<MessageSelectionToolbar {...actions} progress={{ action: 'save', current: 1, total: 3 }} />);
  expect(screen.getByText('chat.selection.saving')).toBeTruthy();
  for (const name of ['common.save', 'chat.messageActions.forward', 'chat.messageActions.collect', 'common.delete', 'common.cancel']) {
    expect(screen.getByRole('button', { name })).toBeDisabled();
    fireEvent.press(screen.getByRole('button', { name }));
  }
  for (const callback of [actions.onSave, actions.onForward, actions.onCollect, actions.onDelete, actions.onCancel]) expect(callback).not.toHaveBeenCalled();
});
