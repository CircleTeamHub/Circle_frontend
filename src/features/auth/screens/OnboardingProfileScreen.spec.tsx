import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import OnboardingProfileScreen from './OnboardingProfileScreen';
import { updateUserProfile } from '@/services/api/profile';
import { requestUploadPresign, uploadLocalFileToPresignedUrl } from '@/services/api/upload';

const mockLaunch = jest.fn();
const mockUser = {
  id: 'u1',
  accountId: 'neo',
  nickname: 'Neo',
  persona: 'Hello there',
  city: '北京',
  gender: 'male',
  avatarUrl: null,
};
const mockAuthState = {
  user: mockUser,
  setUser: jest.fn(),
  setOnboardingRequired: jest.fn(),
  accessToken: null,
  refreshToken: null,
};

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/storage', () => ({
  storage: { getString: jest.fn(), set: jest.fn() },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/features/auth/components/CityPickerSheet', () => ({ CityPickerSheet: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({
  KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/features/profile/image-picker', () => ({
  loadImagePickerModule: () => ({ launchImageLibraryAsync: mockLaunch }),
  launchImageLibraryFast: async (picker: { launchImageLibraryAsync: () => Promise<unknown> }) => ({
    status: 'picked',
    result: await picker.launchImageLibraryAsync(),
  }),
}));
jest.mock('@/features/profile/image-crop-step', () => ({
  useImageCropStep: () => ({ cropIfNeeded: async (asset: unknown) => asset, cropper: null }),
  getCropLibraryPickerOptions: () => ({}),
}));
jest.mock('@/features/chat/utils/chat-image-compress', () => ({
  prepareChatImageForUpload: jest.fn(async (input: unknown) => input),
}));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  uploadLocalFileToPresignedUrl: jest.fn(),
  resolveUploadContentType: ({ mimeType }: { mimeType?: string }) => mimeType,
  sanitizeUploadFilename: (name: string) => name,
}));
jest.mock('@/services/api/profile', () => ({ updateUserProfile: jest.fn() }));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/stores/authStore', () => {
  const useAuthStore = (selector: (state: unknown) => unknown) => selector(mockAuthState);
  useAuthStore.getState = () => mockAuthState;
  return { useAuthStore };
});
jest.mock('@/stores/knownAccountsStore', () => ({
  useKnownAccountsStore: { getState: () => ({ upsertAccount: jest.fn() }) },
}));
jest.mock('@/features/messages/store/use-message-groups-store', () => ({
  useMessageGroupsStore: { getState: () => ({ load: jest.fn(async () => undefined) }) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockLaunch.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///me.jpg', fileName: 'me.jpg', mimeType: 'image/jpeg', width: 800, height: 800 }],
  });
  jest.mocked(requestUploadPresign).mockResolvedValue({
    uploadUrl: 'https://upload.test',
    fileUrl: 'https://cdn.test/avatars/me.jpg',
    key: 'avatars/me.jpg',
    requiredHeaders: { 'Content-Type': 'image/jpeg', 'Content-Length': '12', 'If-None-Match': '*' },
  } as never);
  jest.mocked(uploadLocalFileToPresignedUrl).mockResolvedValue(undefined as never);
  jest.mocked(updateUserProfile).mockResolvedValue(mockUser as never);
});

test('the avatar uploads as soon as it is picked and finishing does not upload it again', async () => {
  render(<OnboardingProfileScreen />);

  await act(async () => {
    fireEvent.press(screen.getByText('profileFields.selectFromAlbum'));
  });
  await waitFor(() => expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(1));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test', 'image/jpeg', 'file:///me.jpg', expect.any(Object), undefined,
    { progressKey: expect.any(String), foreground: true },
  );
  expect(updateUserProfile).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByText('onboarding.finish'));
  });
  await waitFor(() => expect(updateUserProfile).toHaveBeenCalledWith(
    'u1',
    expect.objectContaining({ avatarUrl: 'https://cdn.test/avatars/me.jpg' }),
    mockUser,
  ));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(1);
});

test('an avatar that still fails stops finishing with the save-failed message', async () => {
  jest.mocked(uploadLocalFileToPresignedUrl).mockRejectedValue(new Error('network'));
  render(<OnboardingProfileScreen />);

  await act(async () => {
    fireEvent.press(screen.getByText('profileFields.selectFromAlbum'));
  });
  await screen.findByLabelText('common.retry');
  await act(async () => {
    fireEvent.press(screen.getByText('onboarding.finish'));
  });

  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('validation.saveFailed', 'validation.saveFailed'));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(2);
  expect(updateUserProfile).not.toHaveBeenCalled();
});
