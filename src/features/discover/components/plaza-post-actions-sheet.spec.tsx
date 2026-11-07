import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { PlazaPostActionsSheet, type PostAction } from './plaza-post-actions-sheet';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/ui/bottom-sheet-modal', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? <View>{children}</View> : null,
  };
});

const share = jest.fn();
const remove = jest.fn();
const actions: PostAction[] = [
  { key: 'share', label: '分享', icon: 'share-outline', onPress: share },
  { key: 'delete', label: '删除', icon: 'trash-outline', destructive: true, onPress: remove },
];

beforeEach(() => jest.clearAllMocks());

// 一眼看出是在操作哪条帖子。
test('the sheet names the post it acts on', () => {
  render(<PlazaPostActionsSheet visible actions={actions} context="北京来人" onClose={jest.fn()} />);
  expect(screen.getByText('北京来人')).toBeTruthy();
});

// 删除/举报单独一组,和分享隔开,不会顺手点错。
test('destructive actions sit in their own group, apart from share', () => {
  render(<PlazaPostActionsSheet visible actions={actions} onClose={jest.fn()} />);
  const main = within(screen.getByTestId('plaza-actions-main'));
  const danger = within(screen.getByTestId('plaza-actions-danger'));
  expect(main.getByText('分享')).toBeTruthy();
  expect(main.queryByText('删除')).toBeNull();
  expect(danger.getByText('删除')).toBeTruthy();
});

test('picking an action closes the sheet and runs it', () => {
  const onClose = jest.fn();
  render(<PlazaPostActionsSheet visible actions={actions} onClose={onClose} />);
  fireEvent.press(screen.getByText('删除'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(share).not.toHaveBeenCalled();
});

test('cancel only closes', () => {
  const onClose = jest.fn();
  render(<PlazaPostActionsSheet visible actions={actions} onClose={onClose} />);
  fireEvent.press(screen.getByText('取消'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(share).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

test('no destructive group is drawn when there is nothing destructive', () => {
  render(<PlazaPostActionsSheet visible actions={[actions[0]]} onClose={jest.fn()} />);
  expect(screen.queryByTestId('plaza-actions-danger')).toBeNull();
});
