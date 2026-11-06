import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MentionPickerPanel } from './MentionPickerPanel';
import type { MentionTarget } from '@/features/chat/utils/chat-send-payloads';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));

const colors = {
  surface: '#fff', surfaceBorder: '#ddd', black: '#000', textSecondary: '#666', text: '#111',
  divider: '#eee', inputBg: '#f5f5f5', primary: '#7c5cf0', iconAccent: '#7c5cf0', warningText: '#b45309',
} as never;
const t = ((key: string, options?: { count?: number }) =>
  options?.count !== undefined ? `${key}:${options.count}` : key) as never;

const all: MentionTarget = { userID: 'AtAllTag', nickname: '所有人', isAll: true };
const owner: MentionTarget = { userID: 'u1', nickname: '老王', role: 'OWNER' };
const member: MentionTarget = { userID: 'u2', nickname: '小李', role: 'MEMBER' };

function renderPanel(candidates: MentionTarget[], visible = true) {
  const onPick = jest.fn();
  render(
    <MentionPickerPanel
      colors={colors}
      t={t}
      mentionPickerVisible={visible}
      visibleMentionCandidates={candidates}
      handlePickMention={onPick}
    />,
  );
  return onPick;
}

test('nothing renders while the picker is closed', () => {
  renderPanel([all, owner], false);
  expect(screen.queryByText('chat.mentions.title')).toBeNull();
});

test('"everyone" is shown as its own row with a hint, members with their role', () => {
  renderPanel([all, owner, member]);
  expect(screen.getByText('chat.mentions.all')).toBeTruthy();
  // 「所有人」只留名字,不再带「提醒群里每一个人」那行说明。
  expect(screen.queryByText('chat.mentions.allHint')).toBeNull();
  expect(screen.getByText('chat.mentions.count:2')).toBeTruthy();
  expect(screen.getByText('chat.groupOwner')).toBeTruthy();
  expect(screen.queryByText('chat.groupAdmin')).toBeNull();
});

test('tapping a row picks that target', () => {
  const onPick = renderPanel([all, member]);
  fireEvent.press(screen.getByLabelText('小李'));
  expect(onPick).toHaveBeenCalledWith(member);
  fireEvent.press(screen.getByLabelText('所有人'));
  expect(onPick).toHaveBeenLastCalledWith(all);
});

test('an empty search says nobody can be mentioned', () => {
  renderPanel([]);
  expect(screen.getByText('chat.mentions.empty')).toBeTruthy();
});
