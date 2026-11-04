import React from 'react';
import { Alert, Platform } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import QrCodeScreen from './QrCodeScreen';

const mockUser = { id: 'internal-user-id', uid: 'internal-im-id', accountId: 'WN728613', nickname: 'Alice', avatarUrl: null as string | null };
let mockParams: { type?: string; id?: string; name?: string; avatarUrl?: string } = {};
const mockCapture = jest.fn();
const mockSave = jest.fn();
const mockCopy = jest.fn();
const mockSuccess = jest.fn();
const mockError = jest.fn();
const mockQrOnly = jest.fn((callback: (png: string) => void) => callback('qr-only-png'));
const mockIssue = jest.fn();

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('expo-clipboard', () => ({ setStringAsync: (...args: unknown[]) => mockCopy(...args) }));
jest.mock('react-native-view-shot', () => ({ captureRef: (...args: unknown[]) => mockCapture(...args) }));
jest.mock('@/features/qr/save-qr-image', () => ({ saveQrPngToLibrary: (...args: unknown[]) => mockSave(...args) }));
jest.mock('@/features/qr/app-qr-scheme', () => ({ OUTBOUND_APP_QR_SCHEME: 'windnoteai-preprod' }));
jest.mock('@/components/app/top-notice-store', () => ({ topNotice: { success: (...args: unknown[]) => mockSuccess(...args), error: (...args: unknown[]) => mockError(...args) } }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: (state: { user: typeof mockUser }) => unknown) => select({ user: mockUser }) }));
jest.mock('@/services/api/qr', () => ({ issueQrToken: (...args: unknown[]) => mockIssue(...args), rotateUserQrToken: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/utils/locale', () => ({ getLocalizedDateTimeLocale: () => 'en-US' }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/features/qr/components/ShareQrSheet', () => ({ ShareQrSheet: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: (props: object) => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return <View testID="user-avatar" {...props} />;
} }));
jest.mock('@/components/ui/circle-avatar', () => ({ CircleAvatar: (props: object) => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return <View testID="circle-avatar" {...props} />;
} }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: (props: object) => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return <View testID="group-avatar" {...props} />;
} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-qrcode-svg', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return function Code({ value, getRef }: { value: string; getRef: (ref: object) => void }) {
    ReactModule.useEffect(() => { getRef({ toDataURL: mockQrOnly }); }, [getRef]);
    return <View testID="qr-code" {...{ value }} />;
  };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-i18next', () => {
  const t = (key: string, options?: { id?: string }) => key === 'qr.accountId' ? `ID: ${options?.id}` : key;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
jest.mock('@/theme', () => ({
  useTheme: () => ({ colors: { background: '#eee', surface: '#fff', text: '#111', textSecondary: '#666', primary: '#5548d9', white: '#fff' } }),
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  Radius: { lg: 16, full: 999 }, Typography: { h3: {}, body: {}, bodyRegular: {}, caption: {} },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockParams = {};
  mockUser.avatarUrl = null;
  mockIssue.mockResolvedValue({ token: 'a'.repeat(32), expiresAt: null });
  mockCapture.mockResolvedValue('complete-card-png');
  mockCopy.mockResolvedValue(undefined);
  mockSave.mockResolvedValue('saved');
});
afterEach(() => jest.restoreAllMocks());

async function openCode() {
  render(<QrCodeScreen />);
  await screen.findByTestId('qr-code');
  fireEvent(screen.getByTestId('qr-card-cover'), 'display');
  fireEvent(screen.getByTestId('qr-card-logo'), 'display');
  const avatar = screen.getByTestId(`${mockParams.type || 'user'}-avatar`);
  if (avatar.props.uri) fireEvent(avatar, 'imageReady');
}

test.each(['user', 'group', 'circle'])('%s card waits for its artwork and remote avatar before saving', async (type) => {
  if (type === 'user') mockUser.avatarUrl = 'https://example.com/me.png';
  else mockParams = { type, id: 'target', avatarUrl: 'https://example.com/group.png' };
  render(<QrCodeScreen />);
  await screen.findByTestId('qr-code');
  await act(async () => fireEvent.press(screen.getByText('qr.saveImage')));
  expect(mockCapture).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId('qr-card-cover'), 'display');
  fireEvent(screen.getByTestId('qr-card-logo'), 'display');
  await act(async () => fireEvent.press(screen.getByText('qr.saveImage')));
  expect(mockCapture).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId(`${type}-avatar`), 'imageReady');
  await act(async () => fireEvent.press(screen.getByText('qr.saveImage')));
  expect(mockCapture).toHaveBeenCalledTimes(1);
});

test('personal QR shows the public account ID and copies only that ID', async () => {
  await openCode();
  expect(screen.getByText('ID: WN728613')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByLabelText('qr.copyId')));
  expect(mockCopy).toHaveBeenCalledWith('WN728613');
  expect(mockSuccess).toHaveBeenCalledWith('qr.idCopied');
});

test('saving a personal QR exports the identity card containing the name, QR and ID', async () => {
  await openCode();
  const card = within(screen.getByTestId('qr-identity-card'));
  expect(card.getByText('Alice')).toBeTruthy();
  expect(card.getByText('ID: WN728613')).toBeTruthy();
  expect(card.getByTestId('qr-code').props.value).toContain('windnoteai-preprod://qr?t=');
  await act(async () => fireEvent.press(screen.getByText('qr.saveImage')));
  expect(mockCapture).toHaveBeenCalledTimes(1);
  expect(mockCapture.mock.calls[0][0].current.props.testID).toBe('qr-identity-card');
  expect(mockCapture.mock.calls[0][1]).toEqual({ format: 'png', result: 'base64' });
  expect(mockSave).toHaveBeenCalledWith('complete-card-png');
  expect(mockQrOnly).not.toHaveBeenCalled();
});

test('card capture failure reports failure without saving an incomplete image', async () => {
  await openCode();
  mockCapture.mockRejectedValueOnce(new Error('capture failed'));
  await act(async () => fireEvent.press(screen.getByText('qr.saveImage')));
  expect(mockSave).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('qr.saveFailedTitle', 'qr.saveFailedMessage');
});

test('copy failure reports an error without a successful copy notice', async () => {
  await openCode();
  mockCopy.mockRejectedValueOnce(new Error('clipboard unavailable'));
  await act(async () => fireEvent.press(screen.getByLabelText('qr.copyId')));
  expect(mockError).toHaveBeenCalledWith('qr.copyIdFailed');
  expect(mockSuccess).not.toHaveBeenCalled();
});

test.each(['group', 'circle'])('%s QR saves a full card with its own identity, QR and expiry', async (type) => {
  mockParams = { type, id: 'target-id', name: 'Our group', avatarUrl: 'https://example.com/group.png' };
  mockIssue.mockResolvedValueOnce({ token: 'b'.repeat(32), expiresAt: '2030-01-01T00:00:00Z' });
  await openCode();
  const card = within(screen.getByTestId('qr-identity-card'));
  expect(card.getByText('Our group')).toBeTruthy();
  expect(card.getByTestId(`${type}-avatar`).props.uri).toBe(mockParams.avatarUrl);
  expect(card.getByText(`qr.${type}CardCaption`)).toBeTruthy();
  expect(card.getByText('qr.expiresBefore')).toBeTruthy();
  expect(card.getByTestId('qr-code').props.value).toContain('windnoteai-preprod://qr?t=' + 'b'.repeat(32));
  expect(mockIssue).toHaveBeenCalledWith({ type: type.toUpperCase(), targetId: 'target-id' });
  expect(screen.queryByText('ID: WN728613')).toBeNull();
  expect(screen.queryByLabelText('qr.copyId')).toBeNull();
  await act(async () => fireEvent.press(screen.getByText('qr.saveImage')));
  expect(mockCapture.mock.calls[0][0].current.props.testID).toBe('qr-identity-card');
  expect(mockSave).toHaveBeenCalledWith('complete-card-png');
  expect(mockQrOnly).not.toHaveBeenCalled();
});
