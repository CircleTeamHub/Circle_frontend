import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import SettingsScreen from './SettingsScreen';
import { updateUserProfile } from '@/services/api/profile';

const mockChangeAvatar = jest.fn();
const mockSetUser = jest.fn();
let mockAvatarOptions: { submit: (url: string) => Promise<void> };
let mockField: string | undefined;
const mockAuth = { user: { id: 'user-a', nickname: 'Ada', avatarUrl: 'https://example.test/a.jpg' }, sessionEpoch: 1, setUser: mockSetUser };
const mockT = (key: string) => key;
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (value: unknown) => unknown) => selector(mockAuth), { getState: () => mockAuth }),
}));
jest.mock('@/hooks/use-change-avatar', () => ({
  useChangeAvatar: (options: typeof mockAvatarOptions) => { mockAvatarOptions = options; return { changeAvatar: mockChangeAvatar, changing: false }; },
}));
jest.mock('@/services/api/profile', () => ({ updateUserProfile: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ field: mockField }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme/tokens'), useTheme: () => ({ colors: {} }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/features/profile/components/profile-field-edit-sheet', () => ({ ProfileFieldEditSheet: () => null }));
jest.mock('@/components/ui/avatar-photo-viewer', () => {
  const { View } = jest.requireActual('react-native');
  return { AvatarPhotoViewer: (props: Record<string, unknown>) => <View testID="avatar-preview" {...props} /> };
});

beforeEach(() => {
  jest.clearAllMocks(); mockField = undefined;
  mockAuth.user = { id: 'user-a', nickname: 'Ada', avatarUrl: 'https://example.test/a.jpg' };
  mockAuth.sessionEpoch += 1;
});

test('the personal avatar row opens a preview before any picker and passes its chosen source', () => {
  render(<SettingsScreen />);
  fireEvent.press(screen.getByText('profileFields.avatar'));
  expect(mockChangeAvatar).not.toHaveBeenCalled();
  const preview = screen.getByTestId('avatar-preview');
  expect(preview.props.uri).toBe(mockAuth.user.avatarUrl);
  fireEvent(preview, 'change', 'camera');
  expect(mockChangeAvatar).toHaveBeenCalledWith('camera');
});

test('the avatar search shortcut also opens the preview without an automatic picker', () => {
  mockField = 'avatar';
  render(<SettingsScreen />);
  expect(screen.getByTestId('avatar-preview')).toBeTruthy();
  expect(mockChangeAvatar).not.toHaveBeenCalled();
});

test('an account switch dismisses the previous account avatar preview', () => {
  const view = render(<SettingsScreen />);
  fireEvent.press(screen.getByText('profileFields.avatar'));
  mockAuth.user = { id: 'user-b', nickname: 'Bea', avatarUrl: 'https://example.test/b.jpg' };
  mockAuth.sessionEpoch += 1;
  view.rerender(<SettingsScreen />);
  expect(screen.queryByTestId('avatar-preview')).toBeNull();
});

test('an avatar PATCH response cannot replace the newly logged-in account', async () => {
  let finish!: (value: unknown) => void;
  jest.mocked(updateUserProfile).mockReturnValue(new Promise((resolve) => { finish = resolve; }) as never);
  render(<SettingsScreen />);
  const request = mockAvatarOptions.submit('https://example.test/new.jpg');
  mockAuth.user = { id: 'user-b', nickname: 'Bea', avatarUrl: 'https://example.test/b.jpg' };
  mockAuth.sessionEpoch += 1;
  await act(async () => { finish({ id: 'user-a' }); await request; });
  expect(mockSetUser).not.toHaveBeenCalled();
});
