import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import ChatInfoScreen from './ChatInfoScreen';
import { createCircleChatConversation, fetchChatMembers, refreshChatConversation } from '@/chat-core/api';
import type { ChatConversationDto } from '@/chat-core/protocol';
import { useChatStore } from '@/chat-core/store';
import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { Spacing } from '@/theme/tokens';
import { fetchCircleDetail } from '@/services/api/circles';
import { readGroupInfoCache, writeGroupInfoCache } from '@/features/chat/group-info-cache';
import { reportHandledFailure } from '@/observability/report-failure';
import { ApiError } from '@/services/api/client';

const mockParams: Record<string, string> = {};
const mockAuth = { sessionEpoch: 0 };
const mockMemberAccess = {
  selfMember: null,
  canViewMembers: false,
  resolved: false,
  revalidate: jest.fn(),
};
const mockUseGroupMemberViewAccess = jest.fn((_params: unknown) => mockMemberAccess);

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // 本页直接从 @/services/api/client 取失败判别,它会把 @/i18n 带进来。
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Radius: {}, Spacing: jest.requireActual('@/theme/tokens').Spacing, Typography: {},
  useTheme: () => ({ colors: {} }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: jest.fn(() => null) }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: jest.fn(() => null) }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
// Group and direct info pages both use MenuRow: render what a user sees and can tap.
jest.mock('@/components/ui/menu-row', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    MenuRow: ({ label, subtitle, rightText, rightElement, onPress }: {
      label: string; subtitle?: string; rightText?: string; rightElement?: React.ReactNode; onPress?: () => void;
    }) => (
      <Pressable onPress={onPress} disabled={!onPress}>
        <Text>{label}</Text>
        {subtitle ? <Text>{subtitle}</Text> : null}
        {rightText ? <Text>{rightText}</Text> : null}
        {rightElement}
      </Pressable>
    ),
  };
});
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/option-picker-sheet', () => ({ OptionPickerSheet: () => null }));
jest.mock('@/components/ui/themed-switch', () => ({ ThemedSwitch: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({
  KeyboardAvoidingContainer: () => null,
}));
jest.mock('@/chat-core/api', () => ({
  createCircleChatConversation: jest.fn(),
  fetchChatMembers: jest.fn(),
  refreshChatConversation: jest.fn(),
}));
jest.mock('@/chat-core/burn-durations', () => ({
  buildBurnDurationOptions: () => [], formatBurnDuration: () => '',
}));
jest.mock('@/chat-core/silence-durations', () => ({
  SILENCE_DURATION_OPTIONS: [], isMemberSilencedNow: () => false,
}));
jest.mock('@/chat-core/client', () => ({ ensureDirectConversation: jest.fn() }));
jest.mock('@/chat-core/store', () => ({
  useChatStore: jest.requireActual('zustand').create(() => ({
    currentUserId: 'me', conversations: [], upsertConversation: jest.fn(),
  })),
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockAuth),
    { getState: () => mockAuth },
  ),
}));
// 群缓存在原生端只在加密库就绪后才工作;给它一个内存 MMKV。
jest.mock('@/storage/encrypted-init', () => {
  const instance = jest.requireActual('react-native-mmkv').createMMKV({ id: 'spec' });
  return { getEncryptedInstance: () => instance, initEncryptedStorage: async () => instance };
});
jest.mock('@/features/discover/store/use-circles-store', () => ({ useCirclesStore: {} }));
jest.mock('@/features/chat/hooks/use-group-member-view-access', () => ({
  useGroupMemberViewAccess: (params: unknown) => mockUseGroupMemberViewAccess(params),
}));
jest.mock('@/features/chat/hooks/use-group-admin-actions', () => ({
  useGroupAdminActions: () => ({
    canChangeRole: () => false, canSilence: () => false, canKick: () => false,
  }),
}));
jest.mock('@/hooks/use-change-avatar', () => ({
  useChangeAvatar: () => ({ changeAvatar: jest.fn(), changing: false }),
}));
jest.mock('@/features/chat/utils/group-reload-key', () => ({
  groupConversationReloadKey: () => '', groupOrCircleMutatedSince: () => false,
}));
jest.mock('@/services/api/circles', () => ({ fetchCircleDetail: jest.fn() }));
jest.mock('@/services/api/friends', () => ({ friendsMutatedSince: () => false }));
jest.mock('@/services/api/groups', () => ({}));
jest.mock('@/services/api/temp-chat', () => ({}));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: () => '' }));
jest.mock('@/components/app/top-notice-store', () => ({ topNotice: {} }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

const members = [
  { userId: 'me', nickname: 'Me', role: 'MEMBER' },
  { userId: 'peer', nickname: 'Live member', role: 'MEMBER' },
];
const standaloneConversation = {
  id: 'group-conversation', type: 'GROUP', circleId: null,
  name: 'Current group', notice: 'Current notice', avatarUrl: 'https://example.com/group.png',
  pinned: true, muted: true, myRole: 'MEMBER',
  policies: {
    membersCanViewRoster: true, membersCanViewProfiles: false,
    memberCanInvite: false, qrJoinEnabled: false,
  },
} as ChatConversationDto;

function queueMetadata() {
  const metadata = deferred<void>();
  jest.mocked(refreshChatConversation).mockImplementationOnce(async (_id, options) => {
    await metadata.promise;
    if (options?.shouldApply?.() !== false) {
      useChatStore.setState({ conversations: [standaloneConversation] });
    }
  });
  return metadata;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.sessionEpoch += 1;
  Object.keys(mockParams).forEach((key) => delete mockParams[key]);
  Object.assign(mockParams, {
    conversationID: 'group-conversation',
    sourceID: 'group-conversation',
    conversationType: 'group',
    conversationKind: 'group',
    title: 'Saved group',
  });
  useChatStore.setState({ conversations: [] });
  // Pending promises keep the first render deterministic until each test supplies a response.
  jest.mocked(fetchChatMembers).mockReset().mockImplementation(() => new Promise(() => {}));
  jest.mocked(refreshChatConversation).mockReset().mockImplementation(() => new Promise(() => {}));
  jest.mocked(fetchCircleDetail).mockReset().mockImplementation(() => new Promise(() => {}));
  jest.mocked(createCircleChatConversation).mockReset().mockImplementation(() => new Promise(() => {}));
});

afterEach(() => jest.restoreAllMocks());

test('an uncached standalone group loads its members without looking up or creating a circle', async () => {
  const metadata = queueMetadata();
  writeGroupInfoCache(mockAuth.sessionEpoch, 'standalone:group-conversation', {
    members: [{ userId: 'old', nickname: 'Cached member' }] as never,
  });
  const directory = deferred<unknown>();
  jest.mocked(fetchChatMembers).mockReturnValueOnce(directory.promise as never);

  render(<ChatInfoScreen />);
  expect(fetchChatMembers).toHaveBeenCalledWith('group-conversation');
  expect(fetchCircleDetail).not.toHaveBeenCalled();
  expect(createCircleChatConversation).not.toHaveBeenCalled();
  expect(mockUseGroupMemberViewAccess).toHaveBeenLastCalledWith(expect.objectContaining({
    enabled: false, groupID: '',
  }));
  expect(screen.queryByText('Cached member')).toBeNull();

  await act(async () => { metadata.resolve(); directory.resolve(members); });
  expect(await screen.findByText('Live member')).toBeTruthy();
  expect(screen.queryByText('Cached member')).toBeNull();
  expect(readGroupInfoCache(mockAuth.sessionEpoch, 'standalone:group-conversation')?.members)
    .toEqual(members);
});

test('an uncached standalone group keeps the roster hidden if its seat check fails', async () => {
  writeGroupInfoCache(mockAuth.sessionEpoch, 'standalone:group-conversation', {
    members: [{ userId: 'old', nickname: 'Cached member' }] as never,
  });
  const directory = deferred<unknown>();
  jest.mocked(fetchChatMembers).mockReturnValueOnce(directory.promise as never);

  render(<ChatInfoScreen />);
  expect(fetchChatMembers).toHaveBeenCalledWith('group-conversation');
  expect(screen.queryByText('Cached member')).toBeNull();
  // 只有服务端明确拒绝(401/403/404)才算失座;断网等瞬时失败保留只读快照。
  await act(async () => directory.reject(new ApiError('forbidden', { status: 403 })));
  expect(screen.queryByText('Cached member')).toBeNull();
  expect(readGroupInfoCache(mockAuth.sessionEpoch, 'standalone:group-conversation')).toBeUndefined();
});

test('an uncached circle group still uses its distinct source circle ID', () => {
  mockParams.sourceID = 'circle-1';
  render(<ChatInfoScreen />);
  expect(fetchCircleDetail).toHaveBeenCalledWith('circle-1');
  expect(createCircleChatConversation).toHaveBeenCalledWith('circle-1');
  expect(fetchChatMembers).not.toHaveBeenCalled();
});

test('a cached circle ID takes precedence over standalone route hints', () => {
  useChatStore.setState({
    conversations: [{ id: 'group-conversation', type: 'GROUP', circleId: 'circle-1' }] as ChatConversationDto[],
  });
  render(<ChatInfoScreen />);
  expect(fetchCircleDetail).toHaveBeenCalledWith('circle-1');
  expect(createCircleChatConversation).toHaveBeenCalledWith('circle-1');
  expect(fetchChatMembers).not.toHaveBeenCalled();
  expect(refreshChatConversation).not.toHaveBeenCalled();
});

test('a TEMP route retains the temporary-room member path', () => {
  mockParams.conversationKind = 'temp';
  render(<ChatInfoScreen />);
  expect(fetchChatMembers).toHaveBeenCalledWith('group-conversation');
  expect(fetchCircleDetail).not.toHaveBeenCalled();
  expect(createCircleChatConversation).not.toHaveBeenCalled();
  expect(refreshChatConversation).not.toHaveBeenCalled();
  expect(screen.queryByText('chat.groupNotice')).toBeNull();
});

test('cold standalone info waits for metadata and then uses its notice, avatar, policies and conversation ID', async () => {
  const metadata = queueMetadata();
  jest.mocked(fetchChatMembers).mockResolvedValue(members as never);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  render(<ChatInfoScreen />);
  await act(async () => {});
  expect(refreshChatConversation).toHaveBeenCalledWith('group-conversation', {
    shouldApply: expect.any(Function),
  });
  // A fast member response must not expose profile/invite actions with missing policies.
  await act(async () => {});
  expect(screen.queryByText('Live member')).toBeNull();
  expect(screen.queryByText('qr.groupEntry')).toBeNull();
  expect(screen.queryByText('chat.pinChat')).toBeNull();

  await act(async () => metadata.resolve());
  expect(screen.getByText('Current group')).toBeTruthy();
  expect(screen.getByText('Current notice')).toBeTruthy();
  expect(jest.mocked(GroupChatAvatar).mock.calls.at(-1)?.[0].uri)
    .toBe('https://example.com/group.png');
  expect(screen.queryByText('qr.groupEntry')).toBeNull();

  fireEvent.press(screen.getByText('chat.chatBackground'));
  expect(router.push).toHaveBeenCalledWith(expect.objectContaining({
    params: expect.objectContaining({ conversationID: 'group-conversation' }),
  }));
  fireEvent.press(screen.getByText('Live member'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('chat.profilesRestrictedByGroup'));
  expect(router.navigate).not.toHaveBeenCalled();
  expect(createCircleChatConversation).not.toHaveBeenCalled();
});

test('failed cold metadata stays closed and offers a retry without creating a conversation', async () => {
  const failure = new Error('503');
  jest.mocked(refreshChatConversation).mockRejectedValueOnce(failure);
  jest.mocked(fetchChatMembers).mockResolvedValue(members as never);
  render(<ChatInfoScreen />);

  expect(await screen.findByText('chat.loadFailed')).toBeTruthy();
  expect(screen.queryByText('Live member')).toBeNull();
  expect(screen.queryByText('qr.groupEntry')).toBeNull();
  expect(screen.queryByText('chat.pinChat')).toBeNull();
  expect(reportHandledFailure).toHaveBeenCalledWith('chatInfo', 'loadConversation', failure);

  const metadata = queueMetadata();
  fireEvent.press(screen.getByText('common.retry'));
  expect(refreshChatConversation).toHaveBeenCalledTimes(2);
  await act(async () => metadata.resolve());
  expect(screen.getByText('Current notice')).toBeTruthy();
  expect(createCircleChatConversation).not.toHaveBeenCalled();
});

test.each(['unmount', 'session change'])('a cold metadata response is discarded after %s', async (transition) => {
  const metadata = queueMetadata();
  const view = render(<ChatInfoScreen />);
  const shouldApply = jest.mocked(refreshChatConversation).mock.calls[0]?.[1]?.shouldApply;
  expect(shouldApply?.()).toBe(true);
  if (transition === 'unmount') {
    view.unmount();
  } else {
    mockAuth.sessionEpoch += 1;
    view.rerender(<ChatInfoScreen />);
  }

  expect(shouldApply?.()).toBe(false);
  await act(async () => metadata.resolve());
  expect(useChatStore.getState().conversations).toEqual([]);
  expect(reportHandledFailure).not.toHaveBeenCalled();
});

// 进页不卡:头像墙(最多 20 格)首帧不画,好让推入动画立刻开始;下一帧从缓存画出,
// 不等重新拉取(拉取一直挂着,看得到的只能是缓存)。
test('known standalone membership paints warmed members on the next frame, before revalidation', async () => {
  useChatStore.setState({ conversations: [standaloneConversation] });
  writeGroupInfoCache(mockAuth.sessionEpoch, 'standalone:group-conversation', { members: members as never });
  render(<ChatInfoScreen />);
  expect(screen.queryByText('Live member')).toBeNull();
  expect(await screen.findByText('Live member')).toBeTruthy();
  expect(fetchChatMembers).toHaveBeenCalledWith('group-conversation');
});

test('warmed members remain hidden when the current roster policy forbids them', async () => {
  useChatStore.setState({ conversations: [{ ...standaloneConversation,
    policies: { ...standaloneConversation.policies!, membersCanViewRoster: false },
  }] });
  writeGroupInfoCache(mockAuth.sessionEpoch, 'standalone:group-conversation', { members: members as never });
  render(<ChatInfoScreen />);
  // 等过头像墙延后的那一帧再断言,否则「没画」可能只是还没到那一帧。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByText('Live member')).toBeNull();
});

test('member avatars fit inside their cells on a narrow folding-phone cover screen', async () => {
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  jest.spyOn(native, 'useWindowDimensions').mockReturnValue({ width: 344, height: 882, scale: 2.625, fontScale: 1 });
  useChatStore.setState({ conversations: [standaloneConversation] });
  writeGroupInfoCache(mockAuth.sessionEpoch, 'standalone:group-conversation', { members: members as never });
  render(<ChatInfoScreen />);
  expect(await screen.findByText('Live member')).toBeTruthy();

  // Five columns share the card's inner width: page padding (lg) plus card padding (sm) per side.
  const cellWidth = (344 - 2 * (Spacing.lg + Spacing.sm)) / 5;
  const sizes = jest.mocked(Avatar).mock.calls
    .filter(([props]) => props.shape === 'square')
    .map(([props]) => props.size ?? 0);
  expect(sizes.length).toBeGreaterThan(0);
  // A fixed 56pt avatar used to be wider than its ~53pt cell there, so neighbours overlapped.
  for (const size of sizes) expect(size).toBeLessThan(cellWidth);
});
