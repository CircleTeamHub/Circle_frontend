import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import MessageReadersScreen from './MessageReadersScreen';
import { fetchMessageReaders } from '@/chat-core/api';

let mockParams: Record<string, string | undefined> = { conversationId: 'conv-1', messageId: 'msg-1' };
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}:${String(options.count)}` : key,
  }),
}));
jest.mock('@/chat-core/api', () => ({ fetchMessageReaders: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/nav-header', () => {
  const { Text } = jest.requireActual('react-native');
  return { NavHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});
jest.mock('@/theme', () => ({
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  Typography: { body: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({ colors: { background: '#fff', text: '#111', textSecondary: '#666', primary: '#70f', divider: '#eee' } }),
}));

const reader = (id: string) => ({ id, nickname: `成员${id}`, avatarUrl: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { conversationId: 'conv-1', messageId: 'msg-1' };
});

test('lists every returned reader with the total in the title', async () => {
  jest.mocked(fetchMessageReaders).mockResolvedValue({ readers: [reader('1'), reader('2')], total: 2 });
  render(<MessageReadersScreen />);
  await act(async () => { await Promise.resolve(); });
  expect(fetchMessageReaders).toHaveBeenCalledWith('conv-1', 'msg-1');
  expect(screen.getByText('chat.messageActions.readersTitle:2')).toBeTruthy();
  expect(screen.getByText('成员1')).toBeTruthy();
  expect(screen.getByText('成员2')).toBeTruthy();
  expect(screen.queryByText(/readersMoreFooter/)).toBeNull();
});

test('says how many more read it when the server caps the page', async () => {
  jest.mocked(fetchMessageReaders).mockResolvedValue({ readers: [reader('1')], total: 250 });
  render(<MessageReadersScreen />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('chat.messageActions.readersMoreFooter:249')).toBeTruthy();
});

test('shows the empty state when nobody has read it yet', async () => {
  jest.mocked(fetchMessageReaders).mockResolvedValue({ readers: [], total: 0 });
  render(<MessageReadersScreen />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('chat.messageActions.readersNone')).toBeTruthy();
});

test('a failed load can be retried', async () => {
  jest.mocked(fetchMessageReaders)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ readers: [reader('1')], total: 1 });
  render(<MessageReadersScreen />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.press(screen.getByText('common.retry'));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('成员1')).toBeTruthy();
});

test('missing route params fail without calling the server', async () => {
  mockParams = {};
  render(<MessageReadersScreen />);
  await act(async () => { await Promise.resolve(); });
  expect(fetchMessageReaders).not.toHaveBeenCalled();
  expect(screen.getByText('chat.messageActions.readersFailed')).toBeTruthy();
});
