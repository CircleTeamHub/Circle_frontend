import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import GroupLogScreen from './GroupLogScreen';
import { fetchChatGroupEvents } from '@/chat-core/api';
import type { ChatConversationDto } from '@/chat-core/protocol';

let mockConversations: Partial<ChatConversationDto>[] = [];
const mockAuth = { sessionEpoch: 1, user: { id: 'me' } };
const mockT = (key: string) => key;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ conversationID: 'group-1' }),
  useSegments: () => ['(tabs)', 'profile'],
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (select: (state: unknown) => unknown) => select({ conversations: mockConversations }),
}));
jest.mock('@/features/groups/GroupAdmissionsList', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { GroupAdmissionsList: ({ groupId }: { groupId: string }) => <Text>{`admissions:${groupId}`}</Text> };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@/theme', () => ({
  Radius: { lg: 12, full: 999 },
  Spacing: { xs: 2, sm: 4, md: 8, lg: 16, xl: 24 },
  Typography: { body: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#fff', surfaceBorder: '#ddd',
      text: '#111', textSecondary: '#666', primary: '#00f', white: '#fff',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/member-name', () => {
  const { Text } = jest.requireActual('react-native');
  return { MemberName: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/components/ui/option-picker-sheet', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return { OptionPickerSheet: ({ visible, options, onSelect }: any) => visible ? <>{options.map((option: any) => <Pressable key={option.value} onPress={() => onSelect(option.value)}><Text>{option.label}</Text></Pressable>)}</> : null };
});
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (state: unknown) => unknown) => select(mockAuth), { getState: () => mockAuth }) }));
jest.mock('@/chat-core/group-events', () => ({
  groupEventText: (event: { kind: string }) => event.kind,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/chat-core/api', () => ({ fetchChatGroupEvents: jest.fn() }));

type Page = Awaited<ReturnType<typeof fetchChatGroupEvents>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function event(id: string, text: string) {
  return {
    id,
    kind: 'member-joined',
    actor: null,
    targets: [{ id: `person-${id}`, nickname: text, avatarUrl: null }],
    payload: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  mockConversations = [];
  jest.mocked(fetchChatGroupEvents).mockReset();
});

test('shows admission details in a key/value card without the old application tabs', async () => {
  mockConversations = [{ id: 'group-1', type: 'GROUP', circleId: null, myRole: 'OWNER' }];
  const reviewed = { ...event('reviewed', 'Applicant'), review: { status: 'JOINED', source: 'INVITE', inviter: { id: 'inviter', nickname: 'Inviter', avatarUrl: null }, operator: { id: 'manager', nickname: 'Manager', avatarUrl: null }, blacklisted: false } };
  jest.mocked(fetchChatGroupEvents).mockResolvedValue({ events: [reviewed], nextCursor: null });
  render(<GroupLogScreen />);
  await screen.findByText('Applicant');
  expect(screen.getByText('groupLog.date')).toBeTruthy();
  expect(screen.getByText('groupLog.status')).toBeTruthy();
  expect(screen.getByText('Inviter')).toBeTruthy();
  expect(screen.getByText('Manager')).toBeTruthy();
  expect(screen.queryByText('chat.groupLogAdmissions')).toBeNull();
});

test('omits name/avatar/notice edits from the important log list', async () => {
  jest.mocked(fetchChatGroupEvents).mockResolvedValue({ events: [{ ...event('routine', 'Routine edit'), kind: 'group-renamed' }, event('important', 'Important member')], nextCursor: null });
  render(<GroupLogScreen />);
  await screen.findByText('Important member');
  expect(screen.queryByText('Routine edit')).toBeNull();
});

test('keeps group aliases and the unknown-account fallback on identity cards', async () => {
  jest.mocked(fetchChatGroupEvents).mockResolvedValue({ events: [{ ...event('alias', 'Account name'), targets: [
    { id: 'alias-user', nickname: 'Account name', alias: 'Group alias', avatarUrl: null },
    { id: 'deleted-user', nickname: '', avatarUrl: null },
  ] }], nextCursor: null });
  render(<GroupLogScreen />);
  await screen.findByText('Group alias');
  expect(screen.queryByText('Account name')).toBeNull();
  expect(screen.getByText('groupReview.unknownMember')).toBeTruthy();
});

test('searches all pages for the selected target/operator role', async () => {
  jest.mocked(fetchChatGroupEvents).mockResolvedValue({ events: [], nextCursor: null });
  render(<GroupLogScreen />);
  await screen.findByText('chat.noGroupLog');
  fireEvent.changeText(screen.getByTestId('group-log-search'), '144442');
  fireEvent.press(screen.getByLabelText('groupLog.searchRole'));
  fireEvent.press(screen.getByText('groupLog.actor'));
  fireEvent.press(screen.getByLabelText('common.search'));
  await waitFor(() => expect(fetchChatGroupEvents).toHaveBeenLastCalledWith('group-1', { limit: 50, keyword: '144442', person: 'actor' }));
});

test.each([
  { type: 'GROUP' as const, circleId: null, myRole: 'MEMBER' as const },
  { type: 'GROUP' as const, circleId: 'circle-1', myRole: 'OWNER' as const },
])('does not expose standalone admission history for $myRole with circle $circleId', async (conversation) => {
  mockConversations = [{ id: 'group-1', ...conversation }];
  jest.mocked(fetchChatGroupEvents).mockResolvedValue({ events: [], nextCursor: null });
  render(<GroupLogScreen />);
  await screen.findByText('chat.noGroupLog');
  expect(screen.queryByText('chat.groupLogAdmissions')).toBeNull();
});

test('loads every cursor page once and de-duplicates overlapping group logs', async () => {
  const secondPage = deferred<Page>();
  jest.mocked(fetchChatGroupEvents)
    .mockResolvedValueOnce({ events: [event('2', 'newer')], nextCursor: 'cursor-1' })
    .mockReturnValueOnce(secondPage.promise);

  render(<GroupLogScreen />);
  await screen.findByText('newer');

  const list = screen.getByTestId('group-log-list');
  fireEvent(list, 'onEndReached');
  fireEvent(list, 'onEndReached');
  expect(fetchChatGroupEvents).toHaveBeenCalledTimes(2);
  expect(fetchChatGroupEvents).toHaveBeenLastCalledWith('group-1', {
    limit: 50, cursor: 'cursor-1',
  });

  await act(async () => {
    // 两页之间服务端新增了事件,游标页与上一页重叠一条:合并后只出现一次。
    secondPage.resolve({
      events: [event('1', 'older'), event('2', 'newer')],
      nextCursor: null,
    });
    await secondPage.promise;
  });

  await waitFor(() => expect(screen.getByText('older')).toBeTruthy());
  expect(screen.getAllByText('newer')).toHaveLength(1);
});

test('stops paging when the server hands back the same cursor', async () => {
  jest.mocked(fetchChatGroupEvents)
    .mockResolvedValueOnce({ events: [event('3', 'latest')], nextCursor: 'stuck' })
    .mockResolvedValueOnce({ events: [event('3', 'latest')], nextCursor: 'stuck' });

  render(<GroupLogScreen />);
  await screen.findByText('latest');

  const list = screen.getByTestId('group-log-list');
  fireEvent(list, 'onEndReached');
  await waitFor(() => expect(fetchChatGroupEvents).toHaveBeenCalledTimes(2));

  // 游标没前进就视为到头,再触底不再请求 —— 否则会在同一页上无限打转。
  fireEvent(list, 'onEndReached');
  await act(async () => {
    await Promise.resolve();
  });
  expect(fetchChatGroupEvents).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText('latest')).toHaveLength(1);
});

test('shows the empty state when the log has no entries', async () => {
  jest.mocked(fetchChatGroupEvents).mockResolvedValueOnce({ events: [], nextCursor: null });

  render(<GroupLogScreen />);
  await screen.findByText('chat.noGroupLog');
});
