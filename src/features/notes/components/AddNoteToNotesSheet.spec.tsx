import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AddNoteToNotesSheet } from './AddNoteToNotesSheet';

jest.mock('@/components/ui/floating-modal', () => ({
  FloatingModal: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: React.ReactNode;
  }) => (visible ? <>{children}</> : null),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/theme', () => ({
  Radius: { full: 50, lg: 20, md: 12, sm: 8 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { body: {}, h3: {}, small: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      overlay: '#88000000',
      primary: '#6200ee',
      primaryLight: '#eee8ff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      white: '#fff',
    },
  }),
}));

test('collect sheet keeps the edited title and sends it on save', () => {
  const onConfirm = jest.fn();
  render(
    <AddNoteToNotesSheet
      visible
      noteTitle="原始标题"
      username="alice"
      groups={[{ id: 'group-1', name: '上海场地', sortOrder: 0, noteCount: 0 }]}
      onClose={jest.fn()}
      onConfirm={onConfirm}
    />,
  );

  fireEvent.press(screen.getByText('上海场地'));
  const input = screen.getByDisplayValue('上海场地 alice 原始标题');
  fireEvent.changeText(input, '客户专用标题');
  fireEvent.press(screen.getByText('保存'));

  expect(onConfirm).toHaveBeenCalledWith({
    targetNoteGroupId: 'group-1',
    title: '客户专用标题',
  });
});
