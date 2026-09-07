import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import GroupLogScreen from './GroupLogScreen';
import { searchChatMessages } from '@/chat-core/api';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ conversationID: 'group-1' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/theme', () => ({
  Radius: { lg: 12 },
  Spacing: { sm: 4, md: 8, lg: 16, xl: 24 },
  Typography: { body: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#fff', surfaceBorder: '#ddd',
      text: '#111', textSecondary: '#666', primary: '#00f', white: '#fff',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/chat-core/message-mappers', () => ({ systemNoticeText: () => null }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/chat-core/api', () => ({ searchChatMessages: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function message(id: string, text: string) {
  return { id, createdAt: '2026-01-01T00:00:00.000Z', content: { text } } as never;
}

test('loads every cursor page once and de-duplicates overlapping group logs', async () => {
  const secondPage = deferred<Awaited<ReturnType<typeof searchChatMessages>>>();
  jest.mocked(searchChatMessages)
    .mockResolvedValueOnce({ messages: [message('2', 'newer')], nextBeforeHeight: 50 } as never)
    .mockReturnValueOnce(secondPage.promise);

  render(<GroupLogScreen />);
  await screen.findByText('newer');

  const list = screen.getByTestId('group-log-list');
  fireEvent(list, 'onEndReached');
  fireEvent(list, 'onEndReached');
  expect(searchChatMessages).toHaveBeenCalledTimes(2);
  expect(searchChatMessages).toHaveBeenLastCalledWith('group-1', {
    types: ['system'], limit: 100, beforeHeight: 50,
  });

  await act(async () => {
    secondPage.resolve({
      messages: [message('1', 'older'), message('2', 'newer')],
      nextBeforeHeight: null,
    } as never);
    await secondPage.promise;
  });

  await waitFor(() => expect(screen.getByText('older')).toBeTruthy());
  expect(screen.getAllByText('newer')).toHaveLength(1);
});
