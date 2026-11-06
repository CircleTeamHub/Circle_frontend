import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SEND_CAPTION_MAX_LENGTH, SendConfirmDialog } from './send-confirm-dialog';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/ui/floating-modal', () => ({
  FloatingModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    (visible ? children : null),
}));
jest.mock('@/theme', () => ({
  Radius: { lg: 12 },
  Spacing: { sm: 8, md: 16, lg: 24 },
  Typography: { h3: {}, body: {} },
  useTheme: () => ({
    colors: {
      surface: '#fff', text: '#111', inputBg: '#eee', primary: '#70f',
      white: '#fff', textSecondary: '#666', overlay: 'rgba(0,0,0,0.4)',
    },
  }),
}));

function renderDialog(overrides: Partial<React.ComponentProps<typeof SendConfirmDialog>> = {}) {
  const props = {
    visible: true,
    title: '发送给 小王',
    placeholder: '留言',
    onCancel: jest.fn(),
    onConfirm: jest.fn(),
    ...overrides,
  };
  const view = render(
    <SendConfirmDialog {...props}>
      <Text>[图片]</Text>
    </SendConfirmDialog>,
  );
  return { props, view };
}

test('shows the title, the preview and a bounded caption field', () => {
  renderDialog();
  expect(screen.getByText('发送给 小王')).toBeTruthy();
  expect(screen.getByText('[图片]')).toBeTruthy();
  expect(screen.getByPlaceholderText('留言').props.maxLength).toBe(SEND_CAPTION_MAX_LENGTH);
});

test('confirming hands back the trimmed caption', () => {
  const { props } = renderDialog();
  fireEvent.changeText(screen.getByPlaceholderText('留言'), '  晚上见  ');
  fireEvent.press(screen.getByText('common.send'));
  expect(props.onConfirm).toHaveBeenCalledWith('晚上见');
});

test('confirming without a caption hands back an empty string', () => {
  const { props } = renderDialog();
  fireEvent.press(screen.getByText('common.send'));
  expect(props.onConfirm).toHaveBeenCalledWith('');
});

test('reopening starts with an empty caption', () => {
  const { props, view } = renderDialog();
  fireEvent.changeText(screen.getByPlaceholderText('留言'), '上一次没发');
  view.rerender(
    <SendConfirmDialog {...props} visible={false}><Text>[图片]</Text></SendConfirmDialog>,
  );
  view.rerender(
    <SendConfirmDialog {...props} visible><Text>[图片]</Text></SendConfirmDialog>,
  );
  expect(screen.getByPlaceholderText('留言').props.value).toBe('');
});

test('cancel closes without confirming', () => {
  const { props } = renderDialog();
  fireEvent.press(screen.getByText('common.cancel'));
  expect(props.onCancel).toHaveBeenCalled();
  expect(props.onConfirm).not.toHaveBeenCalled();
});

test('while sending the buttons and caption are locked', () => {
  const { props } = renderDialog({ sending: true });
  expect(screen.getByPlaceholderText('留言').props.editable).toBe(false);
  fireEvent.press(screen.getByText('common.cancel'));
  expect(props.onCancel).not.toHaveBeenCalled();
});
