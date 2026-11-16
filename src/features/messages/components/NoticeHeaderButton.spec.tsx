import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NoticeHeaderButton } from './NoticeHeaderButton';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

const mockTranslate = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('lucide-react-native', () => ({ Bell: () => null }));
jest.mock('@/components/ui/unread-count-badge', () => ({
  UnreadCountBadge: ({ count, testID }: { count: number; testID?: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text testID={testID}>{count}</Text>;
  },
}));
jest.mock('@/theme', () => ({
  useTheme: () => ({ colors: { text: '#111', background: '#fff' } }),
}));

beforeEach(() => {
  useTabBadgeStore.getState().reset();
});

test('counts every non-circle unread: activity, group notices, announcements and pending requests', () => {
  useTabBadgeStore.setState({
    momentsUnread: 2, groupNoticeUnread: 1, profileUnread: 1, contactsUnread: 3, groupAdmissionsUnread: 1,
    // 圈子那份归飞机,不进这里。
    circleUnread: 9, signupUnread: 9,
  });
  render(<NoticeHeaderButton style={null} onPress={jest.fn()} />);
  expect(screen.getByTestId('messages-notice-badge').props.children).toBe(8);
  expect(
    screen.getByRole('button', { name: 'notifications.notice.title, common.unreadCount:{"count":8}' }),
  ).toBeTruthy();
});

test('shows no badge when nothing is unread and still opens the notices', () => {
  const onPress = jest.fn();
  render(<NoticeHeaderButton style={null} onPress={onPress} />);
  expect(screen.queryByTestId('messages-notice-badge')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'notifications.notice.title' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('an offline removal lights the badge as soon as the unread count arrives', () => {
  render(<NoticeHeaderButton style={null} onPress={jest.fn()} />);
  act(() => { useTabBadgeStore.setState({ groupNoticeUnread: 1 }); });
  expect(screen.getByTestId('messages-notice-badge').props.children).toBe(1);
});
