import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import ScanScreen from './ScanScreen';

const mockPick = jest.fn();
const mockScan = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-image-picker', () => ({}));
jest.mock('@/features/profile/image-picker', () => ({
  launchImageLibraryFast: (...args: unknown[]) => mockPick(...args),
}));
jest.mock('@/features/messages/utils/scan-album-qr', () => ({
  scanQrFromAlbum: (...args: unknown[]) => mockScan(...args),
}));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/theme', () => ({
  useTheme: () => ({ colors: {} }),
  Spacing: { sm: 8, md: 12, lg: 16, xl: 24 },
  Radius: { full: 999, lg: 12 },
  Typography: { h3: {}, h2: {}, body: {}, bodyRegular: {} },
}));

afterEach(() => jest.restoreAllMocks());

test('Android album selection scans the original photo and opens its QR result without an editor', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const asset = { uri: 'file:///qr-card.png', width: 960, height: 1440 };
  mockPick.mockResolvedValue({ status: 'picked', result: { canceled: false, assets: [asset] } });
  mockScan.mockResolvedValue({ type: 'qr', data: 'windnoteai-preprod://qr?t=album-test-token' });
  render(<ScanScreen />);

  await act(async () => fireEvent.press(screen.getByLabelText('messages.scanFromAlbum')));

  expect(mockPick).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    allowsEditing: false,
    allowsMultipleSelection: false,
    mediaTypes: ['images'],
  }));
  expect(mockScan).toHaveBeenCalledWith(asset);
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/(tabs)/messages/qr',
    params: { t: 'album-test-token' },
  });
});
