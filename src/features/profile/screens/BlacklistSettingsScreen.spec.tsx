import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import BlacklistSettingsScreen from './BlacklistSettingsScreen';
import { fetchBlockedUsers, removeFriendFromBlacklist } from '@/services/api/friends';

// 与真实 i18next 一样保持同一个 t 引用，否则 loadUsers 每次渲染都换身份、反复重拉。
const mockT = (key: string, options?: Record<string, unknown>) =>
  options && 'date' in options ? `${key}:${String(options.date)}` : key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`icon:${name}`}</Text>;
  },
}));
jest.mock('@/services/api/friends', () => ({
  fetchBlockedUsers: jest.fn(),
  removeFriendFromBlacklist: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/theme', () => {
  const tokens = jest.requireActual('@/theme/tokens');
  return {
    ...tokens,
    useTheme: () => ({
      colors: {
        background: '#f4f5f8', surface: '#fff', divider: '#eee', text: '#111',
        textSecondary: '#666', error: '#e5484d', primary: '#6366f1', surfaceBorder: '#ddd',
      },
    }),
  };
});

const users = [
  { id: 'u1', nickname: 'Alice', avatarUrl: null, blockedAt: '2026-11-01T08:00:00.000Z' },
  { id: 'u2', nickname: 'Bob', avatarUrl: null, blockedAt: 'not-a-date' },
];

test('blocked users share one list card and say when they were blocked', async () => {
  jest.mocked(fetchBlockedUsers).mockResolvedValue(users as never);
  render(<BlacklistSettingsScreen />);

  expect(await screen.findByText('Alice')).toBeTruthy();
  expect(screen.getByText(/^settingsDetails\.privacy\.blacklistBlockedAt:/)).toBeTruthy();
  expect(screen.getByText('settingsDetails.privacy.blacklistUnknownTime')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'settingsDetails.privacy.blacklistRemove' })).toHaveLength(2);
});

test('an empty blacklist shows an illustrated empty state', async () => {
  jest.mocked(fetchBlockedUsers).mockResolvedValue([]);
  render(<BlacklistSettingsScreen />);

  expect(await screen.findByText('settingsDetails.privacy.blacklistEmpty')).toBeTruthy();
  expect(screen.getByText('icon:ban-outline')).toBeTruthy();
});

test('confirming removal drops the user from the list', async () => {
  jest.mocked(fetchBlockedUsers).mockResolvedValue(users as never);
  jest.mocked(removeFriendFromBlacklist).mockResolvedValue(undefined as never);
  const alert = jest.spyOn(Alert, 'alert');
  render(<BlacklistSettingsScreen />);
  await screen.findByText('Alice');

  fireEvent.press(screen.getAllByRole('button', { name: 'settingsDetails.privacy.blacklistRemove' })[0]);
  const confirm = alert.mock.calls[0][2]!.find((action) => action.style === 'destructive')!;
  await act(async () => confirm.onPress!());

  expect(removeFriendFromBlacklist).toHaveBeenCalledWith('u1');
  expect(screen.queryByText('Alice')).toBeNull();
  alert.mockRestore();
});
