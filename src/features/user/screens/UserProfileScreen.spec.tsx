import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import UserProfileScreen from './UserProfileScreen';
import { writeUserProfileCache } from '@/features/user/profile-cache';
import { useFriendRemarkStore } from '@/stores/friendRemarkStore';

const PEER = '11111111-1111-4111-8111-111111111111';
const mockAuth = { sessionEpoch: 0, user: { id: 'me', accountId: 'my-account' } };
const mockT = (key: string, params?: { name?: string }) => key === 'userProfile.originalNickname' ? `Nickname: ${params?.name}` : key;
const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useSegments: () => ['(tabs)', 'contacts'], useLocalSearchParams: () => ({ id: '11111111-1111-4111-8111-111111111111', name: 'Old route remark' }), useFocusEffect: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (value: unknown) => unknown) => select(mockAuth), { getState: () => mockAuth }) }));
jest.mock('@/chat-core/store', () => ({ useChatStore: Object.assign((select: (value: unknown) => unknown) => select({ conversations: [] }), { getState: () => ({ conversations: [] }) }) }));
jest.mock('@/chat-core/client', () => ({ ensureDirectConversation: jest.fn() }));
jest.mock('@/chat-core/use-peer-presence', () => ({ usePeerPresence: () => ({ known: false, online: false, label: '' }) }));
jest.mock('@/services/api/profile', () => ({ fetchUserProfile: jest.fn() }));
jest.mock('@/services/api/friends', () => ({ fetchFriendSettings: jest.fn(), fetchFriendStatus: jest.fn(), friendsMutatedSince: () => false }));
jest.mock('@/services/api/calls', () => ({ createDirectCall: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/features/call/store/use-call-store', () => ({ useCallStore: (select: (value: unknown) => unknown) => select({ setActiveCall: jest.fn() }) }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
// 资料缓存在原生端只在加密库就绪后才工作;给它一个内存 MMKV。
jest.mock('@/storage/encrypted-init', () => {
  const instance = jest.requireActual('react-native-mmkv').createMMKV({ id: 'spec' });
  return { getEncryptedInstance: () => instance, initEncryptedStorage: async () => instance };
});
jest.mock('@/constants/feature-flags', () => ({ FEATURE_FLAGS: { fancyNumbers: false } }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme/tokens'), useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/user-icon-row', () => ({ UserIconRow: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/member-name', () => {
  const { Text } = jest.requireActual('react-native');
  return { MemberName: ({ name }: { name: string }) => <Text>{name}</Text> };
});

function seedProfile(remark: string | null) {
  writeUserProfileCache(mockAuth.sessionEpoch, PEER, {
    profile: { at: Date.now(), value: { id: PEER, name: 'Original nickname', accountId: 'peer-account', avatarFrameAppearance: null, signature: '', contact: { phone: null, email: null, wechat: null, qq: null } } },
    friendStatus: { at: Date.now(), value: 'ACCEPTED' },
    friendSettings: { at: Date.now(), value: { remark, assignedTags: [], availableTags: [], description: null, photos: [], permission: 'FULL' } },
  });
}

beforeEach(() => { mockAuth.sessionEpoch += 1; useFriendRemarkStore.getState().reset(); });

test('a saved remark shows the original nickname below the display name', () => {
  seedProfile('Saved remark');
  render(<UserProfileScreen />);
  expect(screen.getAllByText('Saved remark').length).toBeGreaterThan(0);
  expect(screen.getByText('Nickname: Original nickname')).toBeTruthy();
  expect(screen.queryByText('Nickname: Old route remark')).toBeNull();
});

test('saving and clearing a local remark updates the original nickname line immediately', () => {
  seedProfile(null);
  render(<UserProfileScreen />);
  expect(screen.queryByText('Nickname: Original nickname')).toBeNull();
  act(() => useFriendRemarkStore.getState().setRemark(PEER, 'My remark', 'Original nickname'));
  expect(screen.getByText('Nickname: Original nickname')).toBeTruthy();
  act(() => useFriendRemarkStore.getState().setRemark(PEER, null, 'Original nickname'));
  expect(screen.queryByText('Nickname: Original nickname')).toBeNull();
  expect(screen.getByText('Original nickname')).toBeTruthy();
});
