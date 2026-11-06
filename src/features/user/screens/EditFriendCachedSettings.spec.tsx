import React from 'react';
import { render, screen } from '@testing-library/react-native';
import EditFriendRemarkScreen from './EditFriendRemarkScreen';
import EditFriendTagsScreen from './EditFriendTagsScreen';
import { fetchFriendSettings, type FriendSettings } from '@/services/api/friends';
import { evictUserProfileCache, writeUserProfileCache } from '../profile-cache';
const mockAuth = { sessionEpoch: 77 };
const mockT = (key: string) => key;
let mockMutated = false;
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (s: typeof mockAuth) => unknown) => select(mockAuth), { getState: () => mockAuth }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'friend', name: 'Friend' }), router: { back: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/theme', () => ({ Radius: {}, Spacing: {}, Typography: {}, useTheme: () => ({ colors: {} }) }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { KeyboardAvoidingContainer: View };
});
jest.mock('@/stores/friendRemarkStore', () => ({ useFriendRemarkStore: { getState: () => ({ setRemark: jest.fn() }) } }));
jest.mock('@/services/api/friends', () => ({ fetchFriendSettings: jest.fn(), friendsMutatedSince: () => mockMutated }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_err: unknown, fallback: string) => fallback }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
const settings: FriendSettings = { remark: 'Known remark', permission: 'FULL', availableTags: [{ id: 'tag', ownerID: 'owner', name: 'Known tag', color: null }], assignedTags: [{ id: 'tag', ownerID: 'owner', name: 'Known tag', color: null }], description: null, photos: [] };
beforeEach(() => {
  mockMutated = false;
  evictUserProfileCache(77, 'friend');
  writeUserProfileCache(77, 'friend', { friendSettings: { value: settings, at: Date.now() } });
  jest.mocked(fetchFriendSettings).mockReset().mockReturnValue(new Promise(() => {}));
});
test('remark editor starts with the profile settings already visible', () => {
  render(<EditFriendRemarkScreen />);
  expect(screen.getByDisplayValue('Known remark')).toBeTruthy();
  expect(screen.queryByText('userProfile.editRemark.loading')).toBeNull();
  expect(fetchFriendSettings).not.toHaveBeenCalled();
});
test('tag editor starts with available and assigned tags already visible', () => {
  render(<EditFriendTagsScreen />);
  expect(screen.getByText('Known tag')).toBeTruthy();
  expect(screen.queryByText('contacts.tagsScreen.loading')).toBeNull();
  expect(fetchFriendSettings).not.toHaveBeenCalled();
});
test.each([EditFriendRemarkScreen, EditFriendTagsScreen])('friend writes invalidate cached editable values', (Editor) => {
  mockMutated = true;
  render(<Editor />);
  expect(screen.queryByDisplayValue('Known remark')).toBeNull();
  expect(screen.queryByText('Known tag')).toBeNull();
  expect(fetchFriendSettings).toHaveBeenCalledWith('friend');
});
