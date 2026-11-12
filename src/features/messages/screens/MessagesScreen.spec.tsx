import React from 'react';
import { Bell, CheckCheck, Search } from 'lucide-react-native';
import { Alert, BackHandler, Modal, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import MessagesScreen from './MessagesScreen';
import { markConversationRead } from '@/chat-core/socket-manager';
import { clearChatConversationHistory, updateChatConversationPreferences } from '@/chat-core/api';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import type { ChatConversationDto } from '@/chat-core/protocol';
import { useFriendRemarkStore } from '@/stores/friendRemarkStore';

let mockConversations: ChatConversationDto[];
let mockSplitLayout = false;
let mockCurrentUserId = 'me';
let mockPinnedFoldCount = 0;
let mockScreenLive = true;
let mockSnapshotLoaded = true;
const mockNavigate = jest.fn();
const mockSetTabOptions = jest.fn();
const mockTabNavigation = { setOptions: mockSetTabOptions };
const mockNavigation = { getParent: () => mockTabNavigation };
const mockSetUnread = jest.fn();
const mockRemarkReloadGate = { shouldSkip: () => true, markLoaded: jest.fn() };
const mockTranslate = (key: string) => key;
const mockColors = { text: '#111', textSecondary: '#666', background: '#fff', dangerFill: '#E5484D' };
const mockChatState = () => ({ conversations: mockConversations, currentUserId: mockCurrentUserId, readWatermarks: {}, connected: true, conversationsSnapshotLoaded: mockSnapshotLoaded });

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockNavigate, navigate: mockNavigate }), useNavigation: () => mockNavigation, useFocusEffect: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/theme', () => ({ Spacing: {}, Typography: {}, Radius: {}, withAlpha: jest.requireActual('@/theme/tokens').withAlpha, useTheme: () => ({ colors: mockColors }) }));
jest.mock('@/chat-core/api', () => ({ canSkipConversationFocusReload: jest.fn(() => true), loadChatConversations: jest.fn(), clearChatConversationHistory: jest.fn(), updateChatConversationPreferences: jest.fn() }));
jest.mock('@/chat-core/socket-manager', () => ({ markConversationRead: jest.fn() }));
jest.mock('@/chat-core/store', () => ({
  useChatStore: Object.assign((selector: (state: unknown) => unknown) => selector(mockChatState()), { getState: () => mockChatState(), subscribe: () => () => {} }),
  selectTotalUnread: () => 3,
}));
// 会话列表壳(use-conversation-list-snapshot)只放行与登录账号同一人的 live 会话;
// 账号切换时登录账号与聊天 store 的 currentUserId 一起变。
jest.mock('@/stores/authStore', () => {
  const getState = () => ({ user: { id: mockCurrentUserId }, sessionEpoch: 1 });
  return { useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(getState()), { getState }) };
});
jest.mock('@/chat-core/conversation-selectors', () => ({ selectConversations: (state: { conversations: unknown[] }) => state.conversations }));
jest.mock('@/chat-core/mappers', () => ({ mapChatConversationToUI: (dto: ChatConversationDto) => ({ id: dto.id, sourceID: dto.peer?.id ?? dto.id, name: (dto.type === 'DIRECT' ? dto.peer?.nickname : undefined) ?? dto.name ?? dto.id, conversationType: dto.type === 'DIRECT' ? 'private' : 'group', unreadCount: dto.unreadCount, pinned: dto.pinned ?? false, muted: false, message: '', time: '' }) }));
jest.mock('@/chat-core/composer-drafts', () => ({ useComposerDraftStore: { getState: () => ({ draftsByUser: {} }), subscribe: () => () => {} } }));
jest.mock('@/features/messages/utils/failed-preview', () => ({ selectFailedConversationKey: () => '' }));
jest.mock('@/hooks/use-focus-reload-gate', () => ({ useFocusReloadGate: () => mockRemarkReloadGate }));
jest.mock('@/services/api/friends', () => ({ fetchFriends: jest.fn(), friendsMutatedSince: () => false }));
jest.mock('@/hooks/use-screen-live', () => ({ useScreenLive: () => mockScreenLive }));
jest.mock('@/hooks/use-desktop-split-layout', () => ({ useDesktopSplitLayout: () => mockSplitLayout }));
jest.mock('@/features/messages/store/use-message-groups-store', () => ({ useMessageGroupsStore: (selector: (state: unknown) => unknown) => selector({ groups: [], filterOrder: [] }) }));
jest.mock('@/features/profile/store/use-app-settings-store', () => ({ useAppSettingsStore: (selector: (state: unknown) => unknown) => selector({ pinnedFoldCount: mockPinnedFoldCount }) }));
jest.mock('@/stores/splitPaneStore', () => ({ useSplitPaneStore: (selector: (state: unknown) => unknown) => selector({ listPaneWidth: 320 }) }));
jest.mock('@/stores/tabBadgeStore', () => ({ useTabBadgeStore: (selector: (state: unknown) => unknown) => selector({ setMessagesUnread: mockSetUnread, circleUnread: 2, signupUnread: 1 }) }));
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
jest.mock('@/components/ui/filter-tabs', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { FilterTabs: ({ tabs, onTabPress }: { tabs: string[]; onTabPress: (index: number) => void }) => <>{tabs.map((tab, index) => <Pressable key={tab} accessibilityRole="button" accessibilityLabel={tab} onPress={() => onTabPress(index)}><Text>{tab}</Text></Pressable>)}</> };
});
jest.mock('@/features/assistant/components/AssistantAvatar', () => ({ AssistantAvatar: () => null }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockSplitLayout = false;
  mockCurrentUserId = 'me';
  mockPinnedFoldCount = 0;
  mockScreenLive = true;
  mockSnapshotLoaded = true;
  useFriendRemarkStore.getState().reset();
  jest.mocked(clearChatConversationHistory).mockReset().mockResolvedValue(0);
  jest.mocked(updateChatConversationPreferences).mockReset().mockResolvedValue({} as ChatConversationDto);
  mockConversations = ['first', 'second'].map((id, index) => ({ id, type: 'DIRECT', name: id, unreadCount: index + 1, lastMessage: { height: index + 10 } } as ChatConversationDto));
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function openConversationMenu() {
  fireEvent(screen.getByTestId(E2E_TEST_IDS.messagesConversation('first')), 'longPress');
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  return jest.mocked(Alert.alert).mock.calls[0][2]!;
}

function startSelection() {
  fireEvent.press(screen.getByRole('button', { name: 'messages.selectChats' }));
}
function selectRow(id: string) {
  fireEvent.press(screen.getByTestId(E2E_TEST_IDS.messagesConversation(id)));
}
function askToDelete() {
  fireEvent.press(screen.getByRole('button', { name: 'messages.swipeDelete' }));
  return jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find((action) => action.text === 'common.delete')!;
}

test('saved remarks update an already mounted list without changing the cached conversation', () => {
  mockConversations[0] = { ...mockConversations[0], peer: { id: 'peer', nickname: 'Original name' } } as ChatConversationDto;
  const raw = mockConversations[0];
  render(<MessagesScreen />);
  expect(screen.getByText('Original name')).toBeTruthy();
  act(() => useFriendRemarkStore.getState().setRemark('peer', 'My remark', 'Original name'));
  expect(screen.getByText('My remark')).toBeTruthy();
  expect(mockConversations[0]).toBe(raw);
  act(() => useFriendRemarkStore.getState().setRemark('peer', 'Updated remark', 'Original name'));
  expect(screen.getByText('Updated remark')).toBeTruthy();
  act(() => useFriendRemarkStore.getState().setRemark('peer', null, 'Original name'));
  expect(screen.getByText('Original name')).toBeTruthy();
});

test('remarks apply only to direct peers and survive a fresh conversation snapshot', () => {
  mockConversations[0] = { ...mockConversations[0], peer: { id: 'peer', nickname: 'Original name' } } as ChatConversationDto;
  mockConversations.push({ id: 'group', type: 'GROUP', name: 'Group name', peer: { id: 'peer' } } as ChatConversationDto);
  const view = render(<MessagesScreen />);
  act(() => useFriendRemarkStore.getState().setRemark('peer', 'My remark', 'Original name'));
  mockConversations = mockConversations.map(dto => ({ ...dto }));
  view.rerender(<MessagesScreen />);
  expect(screen.getByText('My remark')).toBeTruthy();
  expect(screen.getByText('Group name')).toBeTruthy();
  act(() => useFriendRemarkStore.getState().reset());
  expect(screen.getByText('Original name')).toBeTruthy();
});

test('returning to messages reads remarks saved while the list was inactive', () => {
  mockConversations[0] = { ...mockConversations[0], peer: { id: 'peer', nickname: 'Original name' } } as ChatConversationDto;
  const view = render(<MessagesScreen />);
  mockScreenLive = false;
  view.rerender(<MessagesScreen />);
  act(() => useFriendRemarkStore.getState().setRemark('peer', 'My remark', 'Original name'));
  mockScreenLive = true;
  view.rerender(<MessagesScreen />);
  expect(screen.getByText('My remark')).toBeTruthy();
});

test('quick add stays expanded after release until its menu is dismissed', () => {
  render(<MessagesScreen />);
  const add = () => screen.getByRole('button', { name: 'common.add' });
  fireEvent.press(add());
  expect(add().props.accessibilityState.expanded).toBe(true);
  expect(screen.getByText('messages.addFriend')).toBeTruthy();
  fireEvent(add(), 'pressOut');
  expect(add().props.accessibilityState.expanded).toBe(true);
  fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
  expect(add().props.accessibilityState.expanded).toBe(false);
  expect(screen.queryByText('messages.addFriend')).toBeNull();
});

test('quick add remains expanded while leaving for an action and resets on returning home', () => {
  const view = render(<MessagesScreen />);
  const add = () => screen.getByRole('button', { name: 'common.add' });
  fireEvent.press(add());
  fireEvent.press(screen.getByText('messages.addFriend'));
  expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/messages/add-friend');
  expect(add().props.accessibilityState.expanded).toBe(true);
  mockScreenLive = false;
  view.rerender(<MessagesScreen />);
  expect(add().props.accessibilityState.expanded).toBe(true);
  mockScreenLive = true;
  view.rerender(<MessagesScreen />);
  expect(add().props.accessibilityState.expanded).toBe(false);
});

test('selection hides tab navigation and restores it on cancel and unmount', () => {
  const view = render(<MessagesScreen />);
  startSelection();
  expect(mockSetTabOptions).toHaveBeenLastCalledWith({ tabBarStyle: { display: 'none' } });
  fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }));
  expect(mockSetTabOptions).toHaveBeenLastCalledWith({ tabBarStyle: undefined });
  startSelection();
  view.unmount();
  expect(mockSetTabOptions).toHaveBeenLastCalledWith({ tabBarStyle: undefined });
});

test('the selection footer delete button is a solid red fill, not a faint tint', () => {
  render(<MessagesScreen />);
  startSelection();
  selectRow('first');
  const style = StyleSheet.flatten(screen.getByRole('button', { name: 'messages.swipeDelete' }).props.style);
  expect(style.backgroundColor).toBe(mockColors.dangerFill);
});

test('switching accounts exits selection and restores tab navigation', () => {
  const view = render(<MessagesScreen />);
  startSelection();
  mockCurrentUserId = 'other';
  view.rerender(<MessagesScreen />);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(mockSetTabOptions).toHaveBeenLastCalledWith({ tabBarStyle: undefined });
});

test('the header circle button opens circle notifications inside the messages tab', () => {
  render(<MessagesScreen />);
  // Same size and stroke as the neighbouring double-check icon.
  expect(screen.UNSAFE_getByType(Bell).props).toMatchObject({ size: 22, strokeWidth: 4, absoluteStrokeWidth: true });
  fireEvent.press(screen.getByRole('button', { name: 'notifications.circleTitle' }));
  // Stays in the messages stack so back returns here, not to the circle tab.
  expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/notifications', params: { domain: 'circle' } });
});

test('header double check enters selection without reading chats or navigating', () => {
  render(<MessagesScreen />);
  expect(screen.UNSAFE_getByType(CheckCheck).props.strokeWidth).toBe(4);
  expect(screen.UNSAFE_getByType(Search).props.strokeWidth).toBe(4);
  startSelection();
  selectRow('first');
  expect(screen.getByRole('checkbox', { name: 'first' }).props.accessibilityState.checked).toBe(true);
  expect(screen.getByRole('checkbox', { name: 'second' }).props.accessibilityState.checked).toBe(false);
  expect(markConversationRead).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId(E2E_TEST_IDS.messagesConversation('first')), 'longPress');
  expect(Alert.alert).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }));
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('select all can be undone and only includes the current filter', () => {
  mockConversations.push({ id: 'group', name: 'group', type: 'GROUP', unreadCount: 2 } as ChatConversationDto);
  render(<MessagesScreen />);
  startSelection();
  selectRow('first');
  fireEvent.press(screen.getByRole('button', { name: 'messages.group' }));
  fireEvent.press(screen.getByRole('button', { name: 'messages.selectAll' }));
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  expect(screen.getByRole('checkbox', { name: 'group' }).props.accessibilityState.checked).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: 'messages.deselectAll' }));
  expect(screen.getByRole('checkbox', { name: 'group' }).props.accessibilityState.checked).toBe(false);
  fireEvent.press(screen.getByRole('button', { name: 'messages.private' }));
  expect(screen.getByRole('checkbox', { name: 'first' }).props.accessibilityState.checked).toBe(false);
});

test('selection expands folded pinned conversations so select all has no hidden targets', () => {
  mockPinnedFoldCount = 1;
  mockConversations = mockConversations.map((dto) => ({ ...dto, pinned: true }));
  render(<MessagesScreen />);
  expect(screen.queryByTestId(E2E_TEST_IDS.messagesConversation('second'))).toBeNull();
  startSelection();
  expect(screen.getByTestId(E2E_TEST_IDS.messagesConversation('second'))).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'messages.selectAll' }));
  expect(screen.getAllByRole('checkbox').every((node) => node.props.accessibilityState.checked)).toBe(true);
});

test('batch read marks only selected chats using their latest heights', () => {
  render(<MessagesScreen />);
  startSelection();
  selectRow('first');
  mockConversations = mockConversations.map((dto) => dto.id === 'first' ? { ...dto, lastMessage: { ...dto.lastMessage!, height: 99 } } : dto);
  fireEvent.press(screen.getByRole('button', { name: 'messages.swipeMarkRead' }));
  expect(markConversationRead).toHaveBeenCalledTimes(1);
  expect(markConversationRead).toHaveBeenCalledWith('first', 99);
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('a stale batch-read action cannot read chats for a newly switched account', () => {
  render(<MessagesScreen />);
  startSelection(); selectRow('first');
  mockCurrentUserId = 'other';
  fireEvent.press(screen.getByRole('button', { name: 'messages.swipeMarkRead' }));
  expect(markConversationRead).not.toHaveBeenCalled();
});

test('Android back exits selection without changing chat data', () => {
  const subscribe = jest.spyOn(BackHandler, 'addEventListener');
  render(<MessagesScreen />);
  startSelection(); selectRow('first');
  const onBack = subscribe.mock.calls.find(([event]) => event === 'hardwareBackPress')![1];
  act(() => { expect(onBack()).toBe(true); });
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(mockSetTabOptions).toHaveBeenLastCalledWith({ tabBarStyle: undefined });
  expect(markConversationRead).not.toHaveBeenCalled();
  expect(clearChatConversationHistory).not.toHaveBeenCalled();
});

test('batch deletion confirms first and clears only personal history before hiding selected chats', async () => {
  render(<MessagesScreen />);
  startSelection(); selectRow('first');
  const confirm = askToDelete();
  expect(Alert.alert).toHaveBeenLastCalledWith('messages.deleteChat', 'messages.batchDeleteConfirm', expect.any(Array));
  expect(clearChatConversationHistory).not.toHaveBeenCalled();
  await act(async () => confirm.onPress!());
  expect(clearChatConversationHistory).toHaveBeenCalledTimes(1);
  expect(clearChatConversationHistory).toHaveBeenCalledWith('first', { forEveryone: false });
  expect(updateChatConversationPreferences).toHaveBeenCalledWith('first', { hidden: true });
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test.each(['clear', 'hide'])('partial deletion keeps failures selected when %s fails', async (stage) => {
  if (stage === 'clear') jest.mocked(clearChatConversationHistory).mockRejectedValueOnce(new Error('offline'));
  else jest.mocked(updateChatConversationPreferences).mockRejectedValueOnce(new Error('offline'));
  render(<MessagesScreen />);
  startSelection();
  fireEvent.press(screen.getByRole('button', { name: 'messages.selectAll' }));
  const confirm = askToDelete();
  await act(async () => confirm.onPress!());
  expect(updateChatConversationPreferences).toHaveBeenCalledTimes(stage === 'clear' ? 1 : 2);
  if (stage === 'clear') expect(updateChatConversationPreferences).not.toHaveBeenCalledWith('first', expect.anything());
  expect(updateChatConversationPreferences).toHaveBeenCalledWith('second', { hidden: true });
  expect(screen.getByRole('checkbox', { name: 'first' }).props.accessibilityState.checked).toBe(true);
  expect(screen.getByRole('checkbox', { name: 'second' }).props.accessibilityState.checked).toBe(false);
  expect(Alert.alert).toHaveBeenLastCalledWith('messages.batchDeleteFailedTitle', 'messages.batchDeleteFailedMessage');
});

test('deletion ignores duplicate confirmations and stops after an account switch', async () => {
  let finish!: () => void;
  jest.mocked(clearChatConversationHistory).mockImplementationOnce(() => new Promise<number>((resolve) => { finish = () => resolve(0); }));
  const view = render(<MessagesScreen />);
  startSelection();
  fireEvent.press(screen.getByRole('button', { name: 'messages.selectAll' }));
  const confirm = askToDelete();
  act(() => { confirm.onPress!(); confirm.onPress!(); });
  expect(clearChatConversationHistory).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'common.cancel' }).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByRole('checkbox', { name: 'first' }).props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: 'messages.group' }));
  expect(screen.getByRole('checkbox', { name: 'first' })).toBeTruthy();
  mockCurrentUserId = 'other';
  view.rerender(<MessagesScreen />);
  await act(async () => finish());
  expect(updateChatConversationPreferences).not.toHaveBeenCalled();
  expect(clearChatConversationHistory).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('checkbox')).toBeNull();
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

test('deleting a direct chat clears only my side before hiding it', async () => {
  render(<MessagesScreen />);
  const actions = openConversationMenu();
  act(() => actions.find((action) => action.text === 'messages.swipeDelete')!.onPress!());
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((button) => button.text === 'common.delete')!.onPress!());
  expect(clearChatConversationHistory).toHaveBeenCalledWith('first', { forEveryone: false });
  expect(updateChatConversationPreferences).toHaveBeenCalledWith('first', { hidden: true });
});

test('desktop split layout also exposes the selected conversation read action', () => {
  mockSplitLayout = true;
  render(<MessagesScreen />);
  const actions = openConversationMenu();
  act(() => actions.find((action) => action.text === 'messages.swipeMarkRead')!.onPress!());
  expect(markConversationRead).toHaveBeenCalledWith('first', 10);
});

test('startup waits instead of declaring the account empty', () => { mockConversations = []; mockSnapshotLoaded = false; const view = render(<MessagesScreen />); expect(screen.queryByText('messages.noConversations')).toBeNull(); expect(screen.getByTestId('conversations-loading')).toBeTruthy(); mockSnapshotLoaded = true; view.rerender(<MessagesScreen />); expect(screen.getByText('messages.noConversations')).toBeTruthy(); });

test('local conversation rows remain visible while the remote snapshot is pending', () => { mockSnapshotLoaded = false; render(<MessagesScreen />); expect(screen.getByText('first')).toBeTruthy(); expect(screen.queryByTestId('conversations-loading')).toBeNull(); });
