import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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

const groups = [{ id: 'group-1', name: '上海场地', sortOrder: 0, noteCount: 0 }];

function renderSheet(props: Partial<React.ComponentProps<typeof AddNoteToNotesSheet>> = {}) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  render(
    <AddNoteToNotesSheet
      visible
      noteTitle="原始标题"
      groups={groups}
      onClose={onClose}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, onClose };
}

test('collect sheet keeps the edited title and sends it on save', () => {
  const { onConfirm } = renderSheet();
  fireEvent.press(screen.getByText('上海场地'));
  fireEvent.changeText(screen.getByLabelText('收藏标题'), '客户专用标题');
  fireEvent.press(screen.getByText('保存'));
  expect(onConfirm).toHaveBeenCalledWith({ targetNoteGroupId: 'group-1', title: '客户专用标题' });
});

test('the title starts empty and falls back to the original title when left blank', () => {
  const { onConfirm } = renderSheet();
  fireEvent.press(screen.getByText('上海场地'));
  const input = screen.getByLabelText('收藏标题');
  expect(input.props.value).toBe('');
  expect(input.props.placeholder).toBe('原始标题');
  fireEvent.press(screen.getByText('保存'));
  expect(onConfirm).toHaveBeenCalledWith({ targetNoteGroupId: 'group-1', title: '原始标题' });
});

test('ticking "do not edit the title next time" is passed along with the save', () => {
  const { onConfirm } = renderSheet();
  fireEvent.press(screen.getByText('上海场地'));
  const checkbox = screen.getByRole('checkbox');
  expect(checkbox.props.accessibilityState.checked).toBe(false);
  fireEvent.press(checkbox);
  fireEvent.press(screen.getByText('保存'));
  expect(onConfirm).toHaveBeenCalledWith({
    targetNoteGroupId: 'group-1',
    title: '原始标题',
    disableTitleEditing: true,
  });
});

test('with group choice off the sheet opens on the title step and cancel closes it', () => {
  const { onConfirm, onClose } = renderSheet({ chooseGroup: false });
  expect(screen.queryByText('上海场地')).toBeNull();
  expect(screen.getByLabelText('收藏标题')).toBeTruthy();
  fireEvent.press(screen.getByText('取消'));
  expect(onClose).toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});

test('with title editing off picking a group saves right away with the original title', () => {
  const { onConfirm } = renderSheet({ editTitle: false });
  fireEvent.press(screen.getByText('上海场地'));
  expect(onConfirm).toHaveBeenCalledWith({ targetNoteGroupId: 'group-1', title: '原始标题' });
  expect(screen.queryByLabelText('收藏标题')).toBeNull();
});

test('a group created from the sheet is selected and moves on to the title step', async () => {
  const onCreateGroup = jest.fn().mockResolvedValue({ id: 'new-group', name: '新分组', sortOrder: 1, noteCount: 0 });
  const { onConfirm } = renderSheet({ onCreateGroup });
  fireEvent.press(screen.getByText('新建分组'));
  fireEvent.changeText(screen.getByPlaceholderText('输入分组名称'), '  新分组  ');
  fireEvent.press(screen.getByText('创建'));
  await waitFor(() => expect(screen.getByLabelText('收藏标题')).toBeTruthy());
  expect(onCreateGroup).toHaveBeenCalledWith('新分组');
  fireEvent.press(screen.getByText('保存'));
  expect(onConfirm).toHaveBeenCalledWith({ targetNoteGroupId: 'new-group', title: '原始标题' });
});

test('a failed group creation keeps the name so the user can retry', async () => {
  const onCreateGroup = jest.fn().mockResolvedValue(null);
  renderSheet({ onCreateGroup });
  fireEvent.press(screen.getByText('新建分组'));
  fireEvent.changeText(screen.getByPlaceholderText('输入分组名称'), '重复');
  fireEvent.press(screen.getByText('创建'));
  await waitFor(() => expect(onCreateGroup).toHaveBeenCalled());
  expect(screen.getByPlaceholderText('输入分组名称').props.value).toBe('重复');
  expect(screen.queryByLabelText('收藏标题')).toBeNull();
});

test('the create-group entry is hidden when the caller cannot create groups', () => {
  renderSheet();
  expect(screen.queryByText('新建分组')).toBeNull();
});
