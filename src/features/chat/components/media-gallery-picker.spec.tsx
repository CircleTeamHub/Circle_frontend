import React from 'react';
import { Alert, FlatList, Linking, View as MockView } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as MediaLibrary from 'expo-media-library';
import { MediaGalleryPicker } from './media-gallery-picker';

jest.mock('expo-media-library', () => ({
  MediaType: { photo: 'photo', video: 'video' },
  SortBy: { creationTime: 'creationTime' },
  requestPermissionsAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  getAssetsAsync: jest.fn(),
  getAlbumsAsync: jest.fn(),
  getAssetInfoAsync: jest.fn(),
  presentPermissionsPickerAsync: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 2048 })),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({
  KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => <MockView>{children}</MockView>,
}));
jest.mock('@/features/chat/components/send-confirm-dialog', () => ({ SEND_CAPTION_MAX_LENGTH: 500 }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/theme', () => ({
  Radius: { md: 10, lg: 14, full: 999 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { body: {}, caption: {}, h3: {}, tiny: {} },
  useTheme: () => ({ colors: { primary: '#7B6CF6' } }),
}));

const library = jest.mocked(MediaLibrary);

function asset(id: string, mediaType: 'photo' | 'video' = 'photo') {
  return {
    id,
    filename: `${id}.${mediaType === 'video' ? 'MOV' : 'HEIC'}`,
    uri: `ph://${id}`,
    mediaType,
    width: 1200,
    height: 900,
    creationTime: 0,
    modificationTime: 0,
    duration: mediaType === 'video' ? 12.4 : 0,
  } as MediaLibrary.Asset;
}

const recent = [asset('a'), asset('b', 'video'), asset('c')];

function grant(accessPrivileges: 'all' | 'limited' = 'all') {
  library.requestPermissionsAsync.mockResolvedValue({ granted: true, accessPrivileges } as never);
}

function renderPicker(props: Partial<React.ComponentProps<typeof MediaGalleryPicker>> = {}) {
  const handlers = { onCancel: jest.fn(), onConfirm: jest.fn(), onPickFromSystem: jest.fn() };
  render(<MediaGalleryPicker mode="send" {...handlers} {...props} />);
  return handlers;
}

async function cells() {
  return screen.findAllByRole('checkbox');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  grant();
  library.getAssetsAsync.mockResolvedValue({ assets: recent, endCursor: 'c', hasNextPage: false, totalCount: 3 });
  library.getAssetInfoAsync.mockImplementation(async (ref) => {
    const item = recent.find((candidate) => candidate.id === (typeof ref === 'string' ? ref : ref.id))!;
    return { ...item, localUri: `file:///photos/${item.filename}#bplist` } as never;
  });
});

afterEach(() => jest.restoreAllMocks());

test('a picker that was never opened does not ask for photo access', () => {
  render(<MediaGalleryPicker mode={null} onCancel={jest.fn()} onConfirm={jest.fn()} onPickFromSystem={jest.fn()} />);
  expect(library.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('asks only for photo and video access and lists recent media newest first', async () => {
  renderPicker();
  expect(await cells()).toHaveLength(3);
  expect(library.requestPermissionsAsync).toHaveBeenCalledWith(false, ['photo', 'video']);
  expect(library.getAssetsAsync).toHaveBeenCalledWith(expect.objectContaining({
    mediaType: ['photo', 'video'],
    sortBy: [['creationTime', false]],
    album: undefined,
  }));
  expect(screen.getByLabelText('chat.mediaPicker.single')).toBeTruthy();
});

test('numbers the selection in tap order and unselecting renumbers the rest', async () => {
  renderPicker();
  const [first, second, third] = await cells();
  fireEvent.press(third);
  fireEvent.press(first);
  fireEvent.press(second);
  expect(screen.getByText('1')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  fireEvent.press(third);
  expect(screen.queryByText('3')).toBeNull();
  expect((await cells()).map((cell) => cell.props.accessibilityState.checked)).toEqual([true, true, false]);
});

test('confirm hands over local files in selection order with the trimmed caption', async () => {
  const { onConfirm } = renderPicker();
  const [first, second] = await cells();
  fireEvent.press(second);
  fireEvent.press(first);
  fireEvent.changeText(screen.getByPlaceholderText('chat.mediaPicker.captionPlaceholder'), '  看这些  ');
  await act(async () => {
    fireEvent.press(screen.getByText('chat.mediaPicker.confirmCount'));
  });
  expect(library.getAssetInfoAsync).toHaveBeenCalledWith(recent[1], { shouldDownloadFromNetwork: true });
  expect(onConfirm).toHaveBeenCalledTimes(1);
  const [assets, caption] = onConfirm.mock.calls[0];
  expect(caption).toBe('看这些');
  expect(assets).toEqual([
    expect.objectContaining({ assetId: 'b', uri: 'file:///photos/b.MOV', type: 'video', duration: 12_400, fileSize: 2048 }),
    expect.objectContaining({ assetId: 'a', uri: 'file:///photos/a.HEIC', type: 'image', duration: null }),
  ]);
});

test('skips items without a local file, says so, and still sends the rest', async () => {
  library.getAssetInfoAsync.mockImplementation(async (ref) => {
    const id = typeof ref === 'string' ? ref : ref.id;
    return { localUri: id === 'b' ? undefined : `file:///photos/${id}.HEIC` } as never;
  });
  const { onConfirm } = renderPicker();
  const [first, second] = await cells();
  fireEvent.press(first);
  fireEvent.press(second);
  await act(async () => {
    fireEvent.press(screen.getByText('chat.mediaPicker.confirmCount'));
  });
  expect(Alert.alert).toHaveBeenCalledWith('chat.mediaPicker.someSkipped');
  expect(onConfirm.mock.calls[0][0].map((item: { assetId: string }) => item.assetId)).toEqual(['a']);
});

test('one item failing to download does not sink the rest of the batch', async () => {
  library.getAssetInfoAsync.mockImplementation(async (ref) => {
    const id = typeof ref === 'string' ? ref : ref.id;
    if (id === 'a') throw new Error('iCloud download failed');
    return { localUri: `file:///photos/${id}.MOV` } as never;
  });
  const { onConfirm } = renderPicker();
  const [first, second] = await cells();
  fireEvent.press(first);
  fireEvent.press(second);
  await act(async () => {
    fireEvent.press(screen.getByText('chat.mediaPicker.confirmCount'));
  });
  expect(Alert.alert).toHaveBeenCalledWith('chat.mediaPicker.someSkipped');
  expect(onConfirm.mock.calls[0][0].map((item: { assetId: string }) => item.assetId)).toEqual(['b']);
});

test('when nothing can be read the picker stays open and says so', async () => {
  library.getAssetInfoAsync.mockRejectedValue(new Error('deleted'));
  const { onConfirm } = renderPicker();
  fireEvent.press((await cells())[0]);
  await act(async () => {
    fireEvent.press(screen.getByText('chat.mediaPicker.confirmCount'));
  });
  expect(Alert.alert).toHaveBeenCalledWith('chat.mediaPicker.resolveFailed');
  expect(onConfirm).not.toHaveBeenCalled();
});

test('closing while a download is still running cancels the send', async () => {
  let finishDownload!: () => void;
  library.getAssetInfoAsync.mockImplementation(() => new Promise((resolve) => {
    finishDownload = () => resolve({ localUri: 'file:///photos/a.HEIC' } as never);
  }));
  const handlers = { onCancel: jest.fn(), onConfirm: jest.fn(), onPickFromSystem: jest.fn() };
  const view = render(<MediaGalleryPicker mode="send" {...handlers} />);
  fireEvent.press((await cells())[0]);
  fireEvent.press(screen.getByText('chat.mediaPicker.confirmCount'));
  fireEvent.press(screen.getByLabelText('common.close'));
  expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  view.rerender(<MediaGalleryPicker mode={null} {...handlers} />);
  await act(async () => finishDownload());
  expect(handlers.onConfirm).not.toHaveBeenCalled();
});

test('a library change refreshes the first page but not a grid that was scrolled further', async () => {
  library.getAssetsAsync.mockResolvedValue({ assets: recent, endCursor: 'c', hasNextPage: true, totalCount: 9 });
  renderPicker();
  await cells();
  const onLibraryChange = library.addListener.mock.calls[0][0] as () => void;
  await act(async () => onLibraryChange());
  expect(library.getAssetsAsync).toHaveBeenCalledTimes(2);
  library.getAssetsAsync.mockResolvedValueOnce({
    assets: [asset('d'), asset('e')], endCursor: 'e', hasNextPage: false, totalCount: 5,
  });
  await act(async () => {
    fireEvent(screen.UNSAFE_getByType(FlatList), 'endReached');
  });
  expect(library.getAssetsAsync).toHaveBeenLastCalledWith(expect.objectContaining({ after: 'c' }));
  expect(await cells()).toHaveLength(5);
  await act(async () => onLibraryChange());
  expect(library.getAssetsAsync).toHaveBeenCalledTimes(3);
});

test('single mode keeps only the latest pick', async () => {
  renderPicker();
  const [first, second] = await cells();
  fireEvent.press(first);
  fireEvent.press(second);
  fireEvent(screen.getByLabelText('chat.mediaPicker.single'), 'valueChange', true);
  expect((await cells()).map((cell) => cell.props.accessibilityState.checked)).toEqual([true, false, false]);
  fireEvent.press(second);
  expect((await cells()).map((cell) => cell.props.accessibilityState.checked)).toEqual([false, true, false]);
});

test('edit mode browses photos only, one at a time, without the single toggle', async () => {
  library.getAssetsAsync.mockResolvedValue({ assets: [recent[0], recent[2]], endCursor: 'c', hasNextPage: false, totalCount: 2 });
  renderPicker({ mode: 'edit' });
  const [first, second] = await cells();
  expect(library.getAssetsAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaType: ['photo'] }));
  expect(screen.queryByLabelText('chat.mediaPicker.single')).toBeNull();
  fireEvent.press(first);
  fireEvent.press(second);
  expect((await cells()).map((cell) => cell.props.accessibilityState.checked)).toEqual([false, true]);
});

test('stops at the selection limit and tells the user', async () => {
  const many = Array.from({ length: 31 }, (_, index) => asset(`p${index}`));
  library.getAssetsAsync.mockResolvedValue({ assets: many, endCursor: 'end', hasNextPage: false, totalCount: 31 });
  renderPicker();
  // The first render window (8 rows of 4) holds all 31 cells.
  const initial = await cells();
  expect(initial).toHaveLength(31);
  for (const cell of initial) fireEvent.press(cell);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledWith('chat.mediaPicker.selectionLimit');
  expect((await cells()).filter((cell) => cell.props.accessibilityState.checked)).toHaveLength(30);
});

test('denied access offers settings and the system picker, keeping the typed caption', async () => {
  library.requestPermissionsAsync.mockResolvedValue({ granted: false, accessPrivileges: 'none' } as never);
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  const { onPickFromSystem } = renderPicker();
  expect(await screen.findByText('chat.mediaPicker.permissionTitle')).toBeTruthy();
  expect(library.getAssetsAsync).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('chat.mediaPicker.openSettings'));
  expect(openSettings).toHaveBeenCalledTimes(1);
  fireEvent.changeText(screen.getByPlaceholderText('chat.mediaPicker.captionPlaceholder'), ' 说明 ');
  fireEvent.press(screen.getByText('chat.mediaPicker.useSystemPicker'));
  expect(onPickFromSystem).toHaveBeenCalledWith('说明');
});

test('an install without gallery support falls back to the system picker only', async () => {
  library.requestPermissionsAsync.mockRejectedValue(new Error('Missing READ_MEDIA_IMAGES'));
  renderPicker();
  expect(await screen.findByText('chat.mediaPicker.useSystemPicker')).toBeTruthy();
  expect(screen.queryByText('chat.mediaPicker.openSettings')).toBeNull();
});

test('limited access shows a manage entry that reopens the system selection', async () => {
  grant('limited');
  library.presentPermissionsPickerAsync.mockResolvedValue(undefined);
  renderPicker();
  await cells();
  fireEvent.press(screen.getByText('chat.mediaPicker.manageAccess'));
  expect(library.presentPermissionsPickerAsync).toHaveBeenCalledTimes(1);
});

test('switching album reloads the grid from that album', async () => {
  const album = { id: 'album-1', title: 'Screenshots', assetCount: 4 } as MediaLibrary.Album;
  library.getAlbumsAsync.mockResolvedValue([album, { id: 'empty', title: 'Empty', assetCount: 0 } as MediaLibrary.Album]);
  renderPicker();
  await cells();
  fireEvent.press(screen.getByLabelText('chat.mediaPicker.switchAlbum'));
  fireEvent.press(await screen.findByLabelText('Screenshots'));
  expect(screen.queryByLabelText('Empty')).toBeNull();
  await waitFor(() => expect(library.getAssetsAsync).toHaveBeenLastCalledWith(expect.objectContaining({ album })));
  expect(screen.getByText('Screenshots')).toBeTruthy();
});

test('preview and confirm stay disabled until something is selected; preview shows the position', async () => {
  const { onConfirm } = renderPicker();
  const [first, second] = await cells();
  fireEvent.press(screen.getByText('chat.mediaPicker.confirm'));
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.press(first);
  fireEvent.press(second);
  fireEvent.press(screen.getByText('chat.mediaPicker.preview'));
  expect(screen.getByText('1/2')).toBeTruthy();
});

test('closing calls onCancel and reopening starts from a clean selection and caption', async () => {
  const handlers = { onCancel: jest.fn(), onConfirm: jest.fn(), onPickFromSystem: jest.fn() };
  const view = render(<MediaGalleryPicker mode="send" {...handlers} />);
  fireEvent.press((await cells())[0]);
  fireEvent.changeText(screen.getByPlaceholderText('chat.mediaPicker.captionPlaceholder'), '旧描述');
  fireEvent.press(screen.getByLabelText('common.close'));
  expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  view.rerender(<MediaGalleryPicker mode={null} {...handlers} />);
  view.rerender(<MediaGalleryPicker mode="send" {...handlers} />);
  expect((await cells()).every((cell) => !cell.props.accessibilityState.checked)).toBe(true);
  expect(screen.getByPlaceholderText('chat.mediaPicker.captionPlaceholder').props.value).toBe('');
});
