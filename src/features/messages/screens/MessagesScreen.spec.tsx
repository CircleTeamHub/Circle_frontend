import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import MessagesScreen from './MessagesScreen';
import { markConversationRead } from '@/chat-core/socket-manager';
import { clearChatConversationHistory, updateChatConversationPreferences } from '@/chat-core/api';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import type { ChatConversationDto } from '@/chat-core/protocol';

let mockConversations: ChatConversationDto[];
let mockSplitLayout = false;
const mockNavigate = jest.fn();
const mockSetUnread = jest.fn();
const mockTranslate = (key: string) => key;
const mockColors = { text: '#111', textSecondary: '#666', background: '#fff' };
const mockChatState = () => ({ conversations: mockConversations, currentUserId: 'me', readWatermarks: {}, connected: true, conversationsSnapshotLoaded: true });

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockNavigate, navigate: mockNavigate }), useFocusEffect: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/theme', () => ({ Spacing: {}, Typography: {}, Radius: {}, useTheme: () => ({ colors: mockColors }) }));
jest.mock('@/chat-core/api', () => ({ canSkipConversationFocusReload: jest.fn(() => true), loadChatConversations: jest.fn(), clearChatConversationHistory: jest.fn(), updateChatConversationPreferences: jest.fn() }));
jest.mock('@/chat-core/socket-manager', () => ({ markConversationRead: jest.fn() }));
jest.mock('@/chat-core/store', () => ({
  useChatStore: Object.assign((selector: (state: unknown) => unknown) => selector(mockChatState()), { getState: () => mockChatState() }),
  selectTotalUnread: () => 3,
}));
jest.mock('@/chat-core/conversation-selectors', () => ({ selectConversations: (state: { conversations: unknown[] }) => state.conversations }));
jest.mock('@/chat-core/mappers', () => ({ mapChatConversationToUI: (dto: ChatConversationDto) => ({ id: dto.id, sourceID: dto.peer?.id ?? dto.id, name: dto.name ?? dto.id, conversationType: dto.type === 'DIRECT' ? 'private' : 'group', unreadCount: dto.unreadCount, pinned: false, muted: false, message: '', time: '' }) }));
jest.mock('@/chat-core/composer-drafts', () => ({ useComposerDraftStore: { getState: () => ({ draftsByUser: {} }) } }));
jest.mock('@/features/messages/utils/failed-preview', () => ({ selectFailedConversationKey: () => '' }));
jest.mock('@/hooks/use-store-while-active', () => ({ useStoreWhileActive: (store: { getState: () => unknown }, selector: (state: unknown) => unknown) => selector(store.getState()) }));
jest.mock('@/hooks/use-screen-live', () => ({ useScreenLive: () => true }));
jest.mock('@/hooks/use-desktop-split-layout', () => ({ useDesktopSplitLayout: () => mockSplitLayout }));
jest.mock('@/features/messages/store/use-message-groups-store', () => ({ useMessageGroupsStore: (selector: (state: unknown) => unknown) => selector({ groups: [], filterOrder: [] }) }));
jest.mock('@/features/profile/store/use-app-settings-store', () => ({ useAppSettingsStore: (selector: (state: unknown) => unknown) => selector({ pinnedFoldCount: 0 }) }));
jest.mock('@/stores/splitPaneStore', () => ({ useSplitPaneStore: (selector: (state: unknown) => unknown) => selector({ listPaneWidth: 320 }) }));
jest.mock('@/stores/tabBadgeStore', () => ({ useTabBadgeStore: (selector: (state: unknown) => unknown) => selector({ setMessagesUnread: mockSetUnread }) }));
jest.mock('@/features/chat/screens/ChatDetailScreen', () => () => null);
jest.mock('@/features/chat/components/ChatConnectionBanner', () => ({ ChatConnectionBanner: () => null }));
jest.mock('@/components/app/split-pane-resizer', () => ({ SplitPaneResizer: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/components/ui/member-name', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { MemberName: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/components/ui/badge', () => ({ Badge: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/filter-tabs', () => ({ FilterTabs: () => null }));
jest.mock('@/features/assistant/components/AssistantAvatar', () => ({ AssistantAvatar: () => null }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockSplitLayout = false;
  mockConversations = ['first', 'second'].map((id, index) => ({ id, type: 'DIRECT', name: id, unreadCount: index + 1, lastMessage: { height: index + 10 } } as ChatConversationDto));
});

afterEach(() => jest.restoreAllMocks());

function openConversationMenu() {
  fireEvent(screen.getByTestId(E2E_TEST_IDS.messagesConversation('first')), 'longPress');
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  return jest.mocked(Alert.alert).mock.calls[0][2]!;
}

test('removes the header bulk-read double check', () => {
  render(<MessagesScreen />);
  expect(screen.queryByText('checkmark-done-outline')).toBeNull();
});

test('native long press marks only the selected conversation read without opening it', () => {
  render(<MessagesScreen />);
  const actions = openConversationMenu();
  act(() => actions.find((action) => action.text === 'messages.swipeMarkRead')!.onPress!());
  expect(markConversationRead).toHaveBeenCalledTimes(1);
  expect(markConversationRead).toHaveBeenCalledWith('first', 10);
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('marks the latest message height when a new message arrives while the menu is open', () => {
  render(<MessagesScreen />);
  const actions = openConversationMenu();
  mockConversations = mockConversations.map((dto) => dto.id === 'first' ? { ...dto, lastMessage: { ...dto.lastMessage!, height: 99 } } : dto);
  act(() => actions.find((action) => action.text === 'messages.swipeMarkRead')!.onPress!());
  expect(markConversationRead).toHaveBeenCalledWith('first', 99);
});

test('long-press deletion retains confirmation and does not delete immediately', () => {
  render(<MessagesScreen />);
  const actions = openConversationMenu();
  act(() => actions.find((action) => action.text === 'messages.swipeDelete')!.onPress!());
  expect(Alert.alert).toHaveBeenLastCalledWith('messages.deleteChat', 'messages.deleteChatConfirmDirect', expect.any(Array));
  expect(clearChatConversationHistory).not.toHaveBeenCalled();
  expect(updateChatConversationPreferences).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('desktop split layout also exposes the selected conversation read action', () => {
  mockSplitLayout = true;
  render(<MessagesScreen />);
  const actions = openConversationMenu();
  act(() => actions.find((action) => action.text === 'messages.swipeMarkRead')!.onPress!());
  expect(markConversationRead).toHaveBeenCalledWith('first', 10);
});
