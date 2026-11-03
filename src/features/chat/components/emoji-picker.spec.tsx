import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { EmojiPicker } from './emoji-picker';

const mockRefresh = jest.fn();
const mockSave = jest.fn();
const mockRemove = jest.fn();
const mockPick = jest.fn();
const mockPresign = jest.fn();
const mockUpload = jest.fn();
const mockSize = jest.fn();
const mockManipulate = jest.fn();
const mockContentType = jest.fn();
const mockAuth = { sessionEpoch: 1 };
const mockState = { items: [{ id: 's1', url: 'https://media.test/signed', width: 40, height: 50 }], loading: false, error: false, refresh: mockRefresh, save: mockSave, remove: mockRemove };
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: { background: '#fff', textSecondary: '#333' } }), Spacing: { md: 12, sm: 8, xs: 4 }, Typography: { small: {} } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign(() => mockAuth.sessionEpoch, { getState: () => mockAuth }) }));
jest.mock('@/features/chat/store/use-sticker-store', () => ({ useStickerStore: Object.assign(() => mockState, { getState: () => mockState }) }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: (...args: unknown[]) => mockManipulate(...args), SaveFormat: { PNG: 'png', JPEG: 'jpeg' } }));
jest.mock('@/features/profile/image-picker', () => ({ launchImageLibraryFast: (...args: unknown[]) => mockPick(...args) }));
jest.mock('@/services/api/upload', () => ({ requestUploadPresign: (...args: unknown[]) => mockPresign(...args), uploadLocalFileToPresignedUrl: (...args: unknown[]) => mockUpload(...args), resolveLocalFileSize: (...args: unknown[]) => mockSize(...args), resolveUploadContentType: () => mockContentType(), sanitizeUploadFilename: (name: string) => name }));
jest.mock('@/features/chat/utils/sticker-error', () => ({ getStickerErrorMessage: (_error: unknown, _t: unknown, fallback: string) => fallback }));

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockRefresh.mockReset(); mockSave.mockReset().mockResolvedValue(undefined); mockRemove.mockReset();
  mockPick.mockReset().mockResolvedValue({ status: 'picked', result: { canceled: false, assets: [{ uri: 'file:///sticker.png', fileName: 'sticker.png', width: 40, height: 50, mimeType: 'image/png' }] } });
  mockSize.mockReset().mockResolvedValue(100);
  mockManipulate.mockReset().mockResolvedValue({ uri: 'file:///prepared.png', width: 40, height: 50 });
  mockContentType.mockReset().mockReturnValue('image/png');
  mockPresign.mockReset().mockResolvedValue({ uploadUrl: 'put', key: 'stickers/alice/key.png', requiredHeaders: {} });
  mockUpload.mockReset().mockResolvedValue(undefined); mockAuth.sessionEpoch = 1;
});
afterEach(() => jest.restoreAllMocks());

test('renders saved stickers, forwards selection, and refreshes on open/foreground', async () => {
  let foreground!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { foreground = callback; return { remove: jest.fn() }; });
  const onSelectSticker = jest.fn(); render(<EmojiPicker onSelect={jest.fn()} onSelectSticker={onSelectSticker} />);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByTestId('custom-sticker-s1'));
  expect(onSelectSticker).toHaveBeenCalledWith(mockState.items[0]);
  const thumbnail = screen.getByTestId('custom-sticker-image-s1');
  expect(thumbnail.props.enforceEarlyResizing).toBe(true);
  expect(thumbnail.props.cachePolicy).toBe('memory');
  expect(thumbnail.props.recyclingKey).toBe('s1');
  act(() => foreground('active')); expect(mockRefresh).toHaveBeenCalledTimes(2);
});

test('unicode-only consumers never fetch or display custom stickers and still insert emoji', () => {
  const select = jest.fn(); render(<EmojiPicker onSelect={select} />);
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('chat.stickers.add')).toBeNull();
  fireEvent.press(screen.getByLabelText('😀'));
  expect(select).toHaveBeenCalledWith('😀');
});

test('photo addition uploads privately before saving its canonical key', async () => {
  render(<EmojiPicker onSelect={jest.fn()} onSelectSticker={jest.fn()} />);
  await act(async () => fireEvent.press(screen.getByLabelText('chat.stickers.add')));
  expect(mockPresign).toHaveBeenCalledWith(expect.objectContaining({ folder: 'stickers', contentType: 'image/png' }));
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenCalledWith({ objectKey: 'stickers/alice/key.png', width: 40, height: 50 });
});

test.each([['image/png', 'png'], ['image/webp', 'png'], ['image/jpeg', 'jpeg'], ['image/heic', 'jpeg']])('strips metadata from %s while preserving alpha with %s output', async (contentType, format) => {
  mockContentType.mockReturnValue(contentType);
  render(<EmojiPicker onSelect={jest.fn()} onSelectSticker={jest.fn()} />);
  await act(async () => fireEvent.press(screen.getByLabelText('chat.stickers.add')));
  expect(mockManipulate).toHaveBeenCalledWith('file:///sticker.png', [], expect.objectContaining({ format }));
  expect(mockUpload.mock.calls[0][2]).toBe('file:///prepared.png');
  expect(mockSize).toHaveBeenCalledWith('file:///prepared.png');
});

test('keeps GIF animation and fails closed if static-image metadata stripping fails', async () => {
  mockContentType.mockReturnValue('image/gif');
  const view = render(<EmojiPicker onSelect={jest.fn()} onSelectSticker={jest.fn()} />);
  await act(async () => fireEvent.press(screen.getByLabelText('chat.stickers.add')));
  expect(mockManipulate).not.toHaveBeenCalled();
  expect(mockUpload.mock.calls[0][2]).toBe('file:///sticker.png');
  mockContentType.mockReturnValue('image/jpeg'); mockManipulate.mockRejectedValue(new Error('decode failed')); mockSave.mockClear(); mockUpload.mockClear();
  await act(async () => fireEvent.press(screen.getByLabelText('chat.stickers.add')));
  expect(mockSave).not.toHaveBeenCalled(); expect(mockUpload).not.toHaveBeenCalled();
  view.unmount();
});

test.each(['denied', 'upload', 'size', 'account'])('does not save a sticker on %s failure/change', async (reason) => {
  if (reason === 'denied') mockPick.mockResolvedValue({ status: 'denied' });
  if (reason === 'upload') mockUpload.mockRejectedValue(new Error('storage down'));
  if (reason === 'size') mockSize.mockResolvedValue(5 * 1024 * 1024 + 1);
  if (reason === 'account') mockUpload.mockImplementation(async () => { mockAuth.sessionEpoch++; });
  render(<EmojiPicker onSelect={jest.fn()} onSelectSticker={jest.fn()} />);
  await act(async () => fireEvent.press(screen.getByLabelText('chat.stickers.add')));
  expect(mockSave).not.toHaveBeenCalled();
  if (reason !== 'account') expect(Alert.alert).toHaveBeenCalled();
});
