import React from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SharePickerScreen from './SharePickerScreen';
import { NoteCard } from '@/features/notes/components/NoteCard';
import type { NoteSummary } from '@/features/notes/types';

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockPending = jest.fn();
const mockFetchNotes = jest.fn();
const mockRefreshConversation = jest.fn();
const mockFetchMembers = jest.fn();
const mockNavigation = { isFocused: jest.fn(() => true) };
const mockChatState = { currentUserId: 'me', conversations: [] as { id: string; type: string; circleId?: string; policies?: { membersCanViewProfiles: boolean } }[] };
const mockAuthState = { sessionEpoch: 1 };
let mockScope = 'messages';
function mockTranslate(key: string, options?: Record<string, unknown>) {
  return String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? ''));
}
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useNavigation: () => mockNavigation, useSegments: () => ['(tabs)', mockScope, 'share-picker'], useLocalSearchParams: () => ({ type: 'note' }) }));
jest.mock('@/chat-core/api', () => ({ refreshChatConversation: (...args: unknown[]) => mockRefreshConversation(...args), fetchChatMembers: (...args: unknown[]) => mockFetchMembers(...args) }));
jest.mock('@/chat-core/store', () => ({ useChatStore: { getState: () => mockChatState } }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuthState } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: mockTranslate } }));
jest.mock('@/services/api/notes', () => ({ fetchNotes: (...args: unknown[]) => mockFetchNotes(...args) }));
jest.mock('@/services/api/collections', () => ({ fetchCollections: jest.fn() }));
jest.mock('@/services/api/friends', () => ({ fetchFriends: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/features/chat/utils/message-collection', () => ({ canResendCollection: () => true }));
jest.mock('@/features/chat/store/use-share-picker-store', () => ({ useSharePickerStore: (selector: (value: unknown) => unknown) => selector({ setPending: mockPending }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'), iconForeground: (color: string) => color,
  useTheme: () => ({ colors: jest.requireActual('@/theme/colors').darkColors, resolvedMode: 'dark' }),
}));
jest.mock('@/utils/client-diagnostics', () => ({ logClientDiagnostic: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

function note(overrides: Partial<NoteSummary>): NoteSummary {
  return { id: 'note', title: 'With cards', contentPreview: 'A note', status: 'ACTIVE', available: true,
    pinned: false, groups: [], cover: null, imageCount: 0, videoCount: 0, mediaCount: 0,
    createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
    cardPreview: { contacts: [{ id: 'person', name: 'Ada' }], groups: [{ id: 'old-group-id', circleId: 'circle', name: 'Circle' }] }, ...overrides };
}
beforeEach(() => {
  jest.clearAllMocks(); mockScope = 'messages';
  mockNavigation.isFocused.mockReturnValue(true);
  mockAuthState.sessionEpoch += 1;
  mockChatState.currentUserId = 'me';
  mockChatState.conversations = [{ id: 'source-conversation', type: 'GROUP', policies: { membersCanViewProfiles: true } }];
  mockRefreshConversation.mockResolvedValue(undefined);
  mockFetchMembers.mockResolvedValue([{ userId: 'me', role: 'MEMBER' }, { userId: 'source-person', role: 'MEMBER' }]);
  mockFetchNotes.mockResolvedValue([note({}), note({ id: 'plain', title: 'Plain', cardPreview: null })]);
});

test('note cards align with the search field and have space between complete cards', async () => {
  render(<SharePickerScreen />);
  await screen.findByText('With cards');
  const list = screen.UNSAFE_getByType(FlatList);
  expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingHorizontal).toBeGreaterThanOrEqual(12);
  const Separator = list.props.ItemSeparatorComponent;
  const gap = render(<Separator />);
  expect(StyleSheet.flatten(gap.UNSAFE_getByType(View).props.style).height).toBeGreaterThanOrEqual(8);
});

test.each(['messages', 'profile', 'discover', 'contacts', 'explore'])('personal card opens details in the %s stack without selecting or sending the note', async (scope) => {
  mockScope = scope;
  render(<SharePickerScreen />);
  await screen.findByText('With cards');
  const stop = jest.fn();
  fireEvent.press(screen.getByText('Ada'), { stopPropagation: stop });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: `/(tabs)/${scope}/user/[id]`, params: { id: 'person', name: 'Ada' } });
  expect(mockPending).not.toHaveBeenCalled();
  expect(screen.queryByText('发送 (1)')).toBeNull();
});

test('circle card uses the canonical circle ID and keeps search and selected notes for return', async () => {
  render(<SharePickerScreen />);
  fireEvent.press(await screen.findByText('With cards'));
  fireEvent.changeText(screen.getByPlaceholderText('搜索'), 'With');
  const stop = jest.fn();
  fireEvent.press(screen.getByText('Circle'), { stopPropagation: stop });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/circle/[id]', params: { id: 'circle' } });
  expect(screen.getByPlaceholderText('搜索').props.value).toBe('With');
  fireEvent.press(screen.getByText('发送 (1)'));
  expect(mockPending).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note-batch', notes: [expect.objectContaining({ id: 'note' })] }));
});

test('standalone group card opens group information using its server conversation ID', async () => {
  mockFetchNotes.mockResolvedValue([note({ cardPreview: { contacts: [], groups: [{ id: 'group-conversation', conversationID: 'group-conversation', name: 'Project group' }] } })]);
  render(<SharePickerScreen />);
  await screen.findByText('With cards');
  fireEvent.press(screen.getByText('Project group'), { stopPropagation: jest.fn() });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/chat-info', params: {
    sourceID: 'group-conversation', conversationID: 'group-conversation', conversationType: 'group', conversationKind: 'group', title: 'Project group', originScope: 'messages',
  } });
  expect(mockPending).not.toHaveBeenCalled();
});

test('source personal card retains its original group context for profile privacy rules', async () => {
  mockFetchNotes.mockResolvedValue([note({ cardPreview: null, collectedFrom: { conversationType: 'group', conversationID: 'source-conversation', clientMsgID: 'message', sender: { id: 'source-person', name: 'Source person' }, group: { id: 'source-circle', name: 'Source circle' } } })]);
  render(<SharePickerScreen />);
  await screen.findByText('With cards');
  fireEvent.press(screen.getByText('Source person'), { stopPropagation: jest.fn() });
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/user/[id]', params: { id: 'source-person', name: 'Source person', viaConversationID: 'source-conversation' } }));
});

test.each(['MEMBER', 'ADMIN', 'OWNER', 'self'])('source sender profile obeys group policy for %s', async (role) => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockChatState.conversations[0].policies = { membersCanViewProfiles: false };
  if (role === 'self') mockChatState.currentUserId = 'source-person';
  mockFetchMembers.mockResolvedValue([{ userId: 'me', role }]);
  mockFetchNotes.mockResolvedValue([note({ cardPreview: null, collectedFrom: { conversationType: 'group', conversationID: 'source-conversation', clientMsgID: 'message', sender: { id: 'source-person', name: 'Source person' }, group: { id: 'source-circle', name: 'Source circle' } } })]);
  render(<SharePickerScreen />);
  await screen.findByText('With cards');
  fireEvent.press(screen.getByText('Source person'), { stopPropagation: jest.fn() });
  if (role === 'MEMBER') {
    await waitFor(() => expect(alert).toHaveBeenCalledWith('该群未开放查看成员资料'));
    expect(mockRouter.push).not.toHaveBeenCalled();
  } else {
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
  }
  if (role === 'self') expect(mockFetchMembers).not.toHaveBeenCalled();
  expect(mockPending).not.toHaveBeenCalled();
  alert.mockRestore();
});

test.each(['denied', 'left group', 'blurred', 'account changed'])('source profile stays closed when access is %s', async (transition) => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let finish!: () => void;
  mockRefreshConversation.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  mockFetchMembers.mockImplementation(async () => {
    if (transition === 'denied') throw new Error('403');
    return transition === 'left group' ? [] : [{ userId: 'me', role: 'MEMBER' }];
  });
  mockFetchNotes.mockResolvedValue([note({ cardPreview: null, collectedFrom: { conversationType: 'group', conversationID: 'source-conversation', clientMsgID: 'message', sender: { id: 'source-person', name: 'Source person' }, group: { id: 'source-circle', name: 'Source circle' } } })]);
  render(<SharePickerScreen />);
  await screen.findByText('With cards');
  fireEvent.press(screen.getByText('Source person'), { stopPropagation: jest.fn() });
  if (transition === 'blurred') mockNavigation.isFocused.mockReturnValue(false);
  if (transition === 'account changed') mockAuthState.sessionEpoch += 1;
  await act(async () => finish());
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockPending).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('source profile uses refreshed policies rather than a previously open snapshot', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockRefreshConversation.mockImplementationOnce(async () => {
    mockChatState.conversations[0].policies = { membersCanViewProfiles: false };
  });
  mockFetchNotes.mockResolvedValue([note({ cardPreview: null, collectedFrom: { conversationType: 'group', conversationID: 'source-conversation', clientMsgID: 'message', sender: { id: 'source-person', name: 'Source person' }, group: { id: 'source-circle', name: 'Source circle' } } })]);
  render(<SharePickerScreen />);
  await screen.findByText('With cards');
  fireEvent.press(screen.getByText('Source person'), { stopPropagation: jest.fn() });
  await waitFor(() => expect(alert).toHaveBeenCalledWith('该群未开放查看成员资料'));
  expect(mockRefreshConversation).toHaveBeenCalledWith('source-conversation', { shouldApply: expect.any(Function) });
  expect(mockRouter.push).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('source circle card opens group information with its separate circle and conversation IDs', async () => {
  mockFetchNotes.mockResolvedValue([note({ cardPreview: null, collectedFrom: { conversationType: 'group', conversationID: 'source-conversation', clientMsgID: 'message', sender: { id: 'source-person', name: 'Source person' }, group: { id: 'source-circle', name: 'Source circle' } } })]);
  render(<SharePickerScreen />);
  await screen.findByText('With cards');
  fireEvent.press(screen.getByText('Source circle'), { stopPropagation: jest.fn() });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/chat-info', params: {
    sourceID: 'source-circle', conversationID: 'source-conversation', conversationType: 'group', conversationKind: 'group', title: 'Source circle', originScope: 'messages',
  } });
});

test('an unrelated explicit personal card does not inherit the collected sender context', async () => {
  mockFetchNotes.mockResolvedValue([note({ collectedFrom: { conversationType: 'group', conversationID: 'source-conversation', clientMsgID: 'message', sender: { id: 'someone-else', name: 'Source person' }, group: { id: 'source-circle', name: 'Source circle' } } })]);
  render(<SharePickerScreen />);
  await screen.findByText('With cards');
  fireEvent.press(screen.getByText('Ada'), { stopPropagation: jest.fn() });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/user/[id]', params: { id: 'person', name: 'Ada' } });
});

test('ordinary note-list multi-selection keeps source navigation disabled by default', () => {
  const onSourcePress = jest.fn();
  render(<NoteCard note={note({})} onPress={jest.fn()} onSourcePress={onSourcePress} selectionMode />);
  fireEvent.press(screen.getByText('Ada'), { stopPropagation: jest.fn() });
  expect(onSourcePress).not.toHaveBeenCalled();
});
