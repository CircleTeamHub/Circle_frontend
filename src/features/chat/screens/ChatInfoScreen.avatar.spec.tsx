import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import ChatInfoScreen from './ChatInfoScreen';
import type { ChatConversationDto } from '@/chat-core/protocol';
import { useChatStore } from '@/chat-core/store';
import type { AvatarImageSource } from '@/hooks/use-change-avatar';

const mockParams: Record<string, string> = {};
const mockAuth = { sessionEpoch: 1, user: { id: 'me' } };
const mockChangeAvatar = jest.fn();
let mockChanging = false;
let mockRole: 'OWNER' | 'ADMIN' | 'MEMBER' = 'MEMBER';
const mockTranslate = (key: string) => key;

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => mockParams,
  // Data loading is outside this avatar-entry contract; the store/cache below supply its state.
  useFocusEffect: () => {},
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Radius: {}, Spacing: {}, Typography: {}, useTheme: () => ({ colors: {} }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/menu-row', () => ({ MenuRow: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/option-picker-sheet', () => ({ OptionPickerSheet: () => null }));
jest.mock('@/components/ui/themed-switch', () => ({ ThemedSwitch: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({ KeyboardAvoidingContainer: () => null }));
jest.mock('@/components/ui/avatar-photo-viewer', () => ({
  AvatarPhotoViewer: ({ visible, ...props }: { visible: boolean; [key: string]: unknown }) => {
    const { createElement } = jest.requireActual('react');
    const { View } = jest.requireActual('react-native');
    return visible ? createElement(View, { ...props, testID: 'avatar-preview' }) : null;
  },
}));
jest.mock('@/chat-core/api', () => ({}));
jest.mock('@/chat-core/burn-durations', () => ({
  buildBurnDurationOptions: () => [], formatBurnDuration: () => '',
}));
jest.mock('@/chat-core/silence-durations', () => ({ SILENCE_DURATION_OPTIONS: [], isMemberSilencedNow: () => false }));
jest.mock('@/chat-core/client', () => ({}));
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
jest.mock('@/features/discover/store/use-circles-store', () => ({ useCirclesStore: {} }));
jest.mock('@/features/chat/hooks/use-group-member-view-access', () => ({
  useGroupMemberViewAccess: () => ({
    selfMember: { userId: 'me', role: mockRole }, canViewMembers: false,
    resolved: true, revalidate: jest.fn(),
  }),
}));
jest.mock('@/features/chat/hooks/use-group-admin-actions', () => ({
  useGroupAdminActions: () => ({
    canChangeRole: () => false, canSilence: () => false, canKick: () => false,
  }),
}));
jest.mock('@/hooks/use-change-avatar', () => ({
  useChangeAvatar: () => ({ changeAvatar: mockChangeAvatar, changing: mockChanging }),
}));
jest.mock('@/features/chat/group-info-cache', () => ({
  readGroupInfoCache: () => ({ members: [{ userId: 'me', nickname: 'Me', role: mockRole }] }),
  writeGroupInfoCache: jest.fn(), evictGroupInfoCache: jest.fn(),
}));
jest.mock('@/features/chat/utils/group-reload-key', () => ({
  groupConversationReloadKey: () => '', groupOrCircleMutatedSince: () => false,
}));
jest.mock('@/services/api/circles', () => ({}));
jest.mock('@/services/api/friends', () => ({ friendsMutatedSince: () => false }));
jest.mock('@/services/api/groups', () => ({}));
jest.mock('@/services/api/temp-chat', () => ({}));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: () => '' }));
jest.mock('@/components/app/top-notice-store', () => ({ topNotice: {} }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockChanging = false;
  mockRole = 'MEMBER';
  Object.assign(mockParams, {
    conversationID: 'group-1', sourceID: 'group-1',
    conversationType: 'group', conversationKind: 'group', title: 'Group name',
  });
});

function showGroup(kind: 'standalone' | 'circle', role: typeof mockRole) {
  mockRole = role;
  const circleId = kind === 'circle' ? 'circle-1' : null;
  mockParams.sourceID = circleId ?? 'group-1';
  useChatStore.setState({
    conversations: [{
      id: 'group-1', type: 'GROUP', circleId, myRole: role,
      name: 'Group name', avatarUrl: 'https://example.com/group.png',
      circle: circleId ? { id: circleId, name: 'Group name', avatarUrl: 'https://example.com/circle.png' } : null,
    }] as ChatConversationDto[],
  });
  render(<ChatInfoScreen />);
  fireEvent.press(screen.getByText('chat.groupAvatar'));
  return screen.getByTestId('avatar-preview');
}

test.each([
  ['standalone', 'OWNER', true],
  ['standalone', 'ADMIN', true],
  ['standalone', 'MEMBER', false],
  ['circle', 'OWNER', true],
  ['circle', 'ADMIN', false],
  ['circle', 'MEMBER', false],
] as const)('%s %s opens the avatar preview with editing permission %s', (kind, role, editable) => {
  const preview = showGroup(kind, role);

  expect(mockChangeAvatar).not.toHaveBeenCalled();
  expect(preview.props.uri).toBe(`https://example.com/${kind === 'circle' ? 'circle' : 'group'}.png`);
  expect(preview.props.name).toBe('Group name');
  expect(preview.props.onChange).toEqual(editable ? expect.any(Function) : undefined);
});

test.each(['camera', 'library'] as const)('an authorized preview forwards the %s action to the shared hook', async (source: AvatarImageSource) => {
  const preview = showGroup('standalone', 'ADMIN');

  await act(async () => { await preview.props.onChange(source); });

  expect(mockChangeAvatar).toHaveBeenCalledTimes(1);
  expect(mockChangeAvatar).toHaveBeenCalledWith(source);
});

test('an uploading group avatar can still be previewed and forwards its busy state', () => {
  mockChanging = true;
  const preview = showGroup('standalone', 'OWNER');

  expect(preview.props.changing).toBe(true);
  expect(mockChangeAvatar).not.toHaveBeenCalled();
});
