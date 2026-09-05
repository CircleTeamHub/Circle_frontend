import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import EditNoteScreen from './EditNoteScreen';
import { VideoDraftPreview } from '@/features/notes/components/VideoDraftPreview';
import { updateNote } from '@/services/api/notes';

const mockRouter = { back: jest.fn(), push: jest.fn() };
const mockRequestPermission = jest.fn();
const mockLaunchPicker = jest.fn();
const mockRequestPresign = jest.fn();
const mockUploadFile = jest.fn();
const mockFetchNoteGroups = jest.fn();
const mockFetchNoteDetail = jest.fn();
const mockConsumePickedLocation = jest.fn();
const mockVideoThumbnailRelease = jest.fn();
const mockGeneratedVideoThumbnail = { nativeRefType: 'image', release: mockVideoThumbnailRelease };
const mockVideoPlayerRelease = jest.fn();
const mockGenerateThumbnails = jest.fn();
const mockReportHandledFailure = jest.fn();
let mockRouteId: string | undefined;
let mockFocusCallback: (() => void | (() => void)) | undefined;
let mockFocusCleanup: (() => void) | undefined;
const mockTranslate = (key: string) => key;

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: mockRouteId }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(() => {
        mockFocusCallback = callback;
        const cleanup = callback();
        mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
        return () => {
          mockFocusCleanup?.();
          mockFocusCleanup = undefined;
        };
      }, [callback]);
    },
  };
});

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestPermission(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchPicker(...args),
}));

jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: (props: object) => <View {...props} /> };
});

jest.mock('expo-video', () => {
  return {
    createVideoPlayer: () => ({
      generateThumbnailsAsync: (...args: unknown[]) => mockGenerateThumbnails(...args),
      release: mockVideoPlayerRelease,
    }),
  };
});

jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/theme', () => ({
  Radius: { xs: 4, md: 8, lg: 12, pill: 999, full: 9999 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  Typography: { small: {}, caption: {}, body: {}, h: {} },
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111',
      textSecondary: '#666', primary: '#6200ee', brandPurple: '#6200ee', white: '#fff',
    },
  }),
}));

jest.mock('@/features/notes/components/NoteBlockEditor', () => ({
  NoteBlockEditor: () => null,
}));

jest.mock('@/features/notes/store/use-note-location-picker-store', () => ({
  useNoteLocationPickerStore: (selector: (state: unknown) => unknown) =>
    selector({ consumePickedLocation: mockConsumePickedLocation }),
}));

jest.mock('@/services/api/notes', () => ({
  createNote: jest.fn(),
  fetchNoteDetail: (...args: unknown[]) => mockFetchNoteDetail(...args),
  fetchNoteGroups: (...args: unknown[]) => mockFetchNoteGroups(...args),
  updateNote: jest.fn(),
}));

jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: () => 'upload failed',
}));

jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: (...args: unknown[]) => mockRequestPresign(...args),
  resolveUploadContentType: () => 'image/jpeg',
  sanitizeUploadFilename: (name: string) => name,
  uploadLocalFileToPresignedUrl: (...args: unknown[]) => mockUploadFile(...args),
}));

jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: (...args: unknown[]) => mockReportHandledFailure(...args),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function locationAction() {
  let node = screen.getByText('notes.edit.pickLocation');
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node;
}

async function beginDeferredImageUpload() {
  const upload = createDeferred<void>();
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///slow.jpg', width: 100, height: 80 }],
  });
  mockRequestPresign.mockResolvedValue({
    uploadUrl: 'https://upload.example/slow.jpg',
    fileUrl: 'https://cdn.example/slow.jpg',
    key: 'notes/slow.jpg',
    requiredHeaders: {},
  });
  mockUploadFile.mockReturnValue(upload.promise);

  fireEvent.press(screen.getByText('notes.edit.addImage'));
  await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(1));
  return upload;
}

test('keeps a selected video preview visible before and after its upload settles', async () => {
  const upload = createDeferred<void>();
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///picked-video.mp4', duration: 1_000, width: 100, height: 80 }],
  });
  mockRequestPresign.mockResolvedValue({
    uploadUrl: 'https://upload.example/picked-video.mp4',
    fileUrl: 'https://cdn.example/picked-video.mp4',
    key: 'notes/picked-video.mp4',
    requiredHeaders: {},
  });
  mockUploadFile.mockReturnValue(upload.promise);

  render(<EditNoteScreen />);
  fireEvent.press(screen.getByText('notes.edit.addVideo'));
  await screen.findByTestId('note-media-preview-video');
  expect(screen.getByTestId('note-media-preview-video').props.source).toBe(mockGeneratedVideoThumbnail);
  expect(mockVideoPlayerRelease).toHaveBeenCalledTimes(1);

  upload.resolve();
  await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('note-media-preview-video')).toBeTruthy();
});

test('releases an in-use native thumbnail when its video tile unmounts', async () => {
  const rendered = render(<VideoDraftPreview uri="file:///release-after-display.mp4" />);
  await screen.findByTestId('note-media-preview-video');

  rendered.unmount();
  expect(mockVideoThumbnailRelease).toHaveBeenCalledTimes(1);
});

test('releases the prior native thumbnail when its preview URI changes', async () => {
  const firstRelease = jest.fn();
  const secondRelease = jest.fn();
  const firstThumbnail = { nativeRefType: 'image', release: firstRelease };
  const secondThumbnail = { nativeRefType: 'image', release: secondRelease };
  mockGenerateThumbnails
    .mockResolvedValueOnce([firstThumbnail])
    .mockResolvedValueOnce([secondThumbnail]);
  const rendered = render(<VideoDraftPreview uri="file:///first-thumbnail.mp4" />);
  await screen.findByTestId('note-media-preview-video');

  rendered.rerender(<VideoDraftPreview uri="file:///second-thumbnail.mp4" />);
  await waitFor(() => expect(secondRelease).not.toHaveBeenCalled());
  await screen.findByTestId('note-media-preview-video');
  expect(firstRelease).toHaveBeenCalledTimes(1);

  rendered.unmount();
  expect(secondRelease).toHaveBeenCalledTimes(1);
});

test('releases a late native thumbnail when its tile unmounts during generation', async () => {
  const deferredThumbnail = createDeferred<typeof mockGeneratedVideoThumbnail[]>();
  mockGenerateThumbnails.mockReturnValueOnce(deferredThumbnail.promise);
  const rendered = render(<VideoDraftPreview uri="file:///release-late.mp4" />);
  await waitFor(() => expect(mockGenerateThumbnails).toHaveBeenCalledTimes(1));

  rendered.unmount();
  await act(async () => {
    deferredThumbnail.resolve([mockGeneratedVideoThumbnail]);
    await deferredThumbnail.promise;
  });
  expect(mockVideoThumbnailRelease).toHaveBeenCalledTimes(1);
});

test('caps section media web-overflow uploads in picker order and reports omitted files', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: Array.from({ length: 12 }, (_, index) => ({
      uri: `file:///section-${index}.jpg`, width: 100, height: 80,
    })),
  });
  mockRequestPresign.mockImplementation(({ filename }: { filename: string }) =>
    Promise.resolve({
      uploadUrl: `https://upload.example/${filename}`,
      fileUrl: `https://cdn.example/${filename}`,
      key: `notes/${filename}`,
      requiredHeaders: {},
    }),
  );
  mockUploadFile.mockResolvedValue(undefined);

  render(<EditNoteScreen />);
  fireEvent.press(screen.getByText('notes.edit.addImage'));

  await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(10));
  expect(mockRequestPresign.mock.calls.map(([request]) => request.filename)).toEqual(
    Array.from({ length: 10 }, (_, index) => `section-${index}.jpg`),
  );
  expect(alert).toHaveBeenCalledWith(
    'notes.editor.selectionLimitExceededTitle',
    'notes.editor.selectionLimitExceededMessage',
  );
});

test('keeps an active web picker preview until the editor unmounts, then revokes it once', async () => {
  const previousWindow = global.window;
  const previousURL = global.URL;
  const revokeObjectURL = jest.fn();
  Object.defineProperty(global, 'window', { configurable: true, value: {} });
  Object.defineProperty(global, 'URL', { configurable: true, value: { revokeObjectURL } });
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'blob:active-image', width: 100, height: 80 }],
  });
  mockRequestPresign.mockResolvedValue({
    uploadUrl: 'https://upload.example/active-image.jpg',
    fileUrl: 'https://cdn.example/active-image.jpg',
    key: 'notes/active-image.jpg',
    requiredHeaders: {},
  });
  mockUploadFile.mockResolvedValue(undefined);

  try {
    const rendered = render(<EditNoteScreen />);
    fireEvent.press(screen.getByText('notes.edit.addImage'));
    await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(1));
    expect(revokeObjectURL).not.toHaveBeenCalled();

    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:active-image');
  } finally {
    Object.defineProperty(global, 'window', { configurable: true, value: previousWindow });
    Object.defineProperty(global, 'URL', { configurable: true, value: previousURL });
  }
});

test('releases overflow and removed main-editor blob previews without revoking active ones early', async () => {
  const previousWindow = global.window;
  const previousURL = global.URL;
  const revokeObjectURL = jest.fn();
  Object.defineProperty(global, 'window', { configurable: true, value: {} });
  Object.defineProperty(global, 'URL', { configurable: true, value: { revokeObjectURL } });
  let resolveUpload!: () => void;
  const upload = new Promise<void>((resolve) => { resolveUpload = resolve; });
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'blob:main-active', width: 100, height: 80 },
      ...Array.from({ length: 9 }, (_, index) => ({ uri: `blob:main-kept-${index}` })),
      { uri: 'blob:main-overflow' },
    ],
  });
  mockRequestPresign.mockResolvedValue({
    uploadUrl: 'https://upload.example/image.jpg',
    fileUrl: 'https://cdn.example/image.jpg',
    key: 'notes/image.jpg',
    requiredHeaders: {},
  });
  mockUploadFile.mockReturnValue(upload);
  try {
    const rendered = render(<EditNoteScreen />);
    fireEvent.press(screen.getByText('notes.edit.addImage'));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:main-overflow'));
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:main-active');

    resolveUpload();
    await upload;
    await waitFor(() => expect(screen.getAllByText('close')).toHaveLength(10));
    fireEvent.press(screen.getAllByText('close')[0]);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:main-active');

    rendered.unmount();
    expect(revokeObjectURL.mock.calls.filter(([uri]) => uri === 'blob:main-active')).toHaveLength(1);
    expect(revokeObjectURL.mock.calls.filter(([uri]) => uri === 'blob:main-overflow')).toHaveLength(1);
  } finally {
    Object.defineProperty(global, 'window', { configurable: true, value: previousWindow });
    Object.defineProperty(global, 'URL', { configurable: true, value: previousURL });
  }
});

test('releases rejected and failed main-editor blob picker URLs exactly once', async () => {
  const previousWindow = global.window;
  const previousURL = global.URL;
  const revokeObjectURL = jest.fn();
  Object.defineProperty(global, 'window', { configurable: true, value: {} });
  Object.defineProperty(global, 'URL', { configurable: true, value: { revokeObjectURL } });
  mockRequestPermission.mockResolvedValue({ granted: true });
  try {
    mockLaunchPicker.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:main-rejected', fileSize: 201 * 1024 * 1024 }],
    });
    const rejected = render(<EditNoteScreen />);
    fireEvent.press(screen.getByText('notes.edit.addVideo'));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:main-rejected'));
    rejected.unmount();

    mockLaunchPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'blob:main-failed' }] });
    mockRequestPresign.mockRejectedValueOnce(new Error('presign failed'));
    const failed = render(<EditNoteScreen />);
    fireEvent.press(screen.getByText('notes.edit.addImage'));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:main-failed'));
    failed.unmount();

    expect(revokeObjectURL.mock.calls.filter(([uri]) => uri === 'blob:main-rejected')).toHaveLength(1);
    expect(revokeObjectURL.mock.calls.filter(([uri]) => uri === 'blob:main-failed')).toHaveLength(1);
  } finally {
    Object.defineProperty(global, 'window', { configurable: true, value: previousWindow });
    Object.defineProperty(global, 'URL', { configurable: true, value: previousURL });
  }
});

test('releases an in-flight main-editor blob preview when its route is replaced', async () => {
  const previousWindow = global.window;
  const previousURL = global.URL;
  const revokeObjectURL = jest.fn();
  Object.defineProperty(global, 'window', { configurable: true, value: {} });
  Object.defineProperty(global, 'URL', { configurable: true, value: { revokeObjectURL } });
  const upload = createDeferred<void>();
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockLaunchPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'blob:route-pending' }] });
  mockRequestPresign.mockResolvedValue({
    uploadUrl: 'https://upload.example/route.jpg', fileUrl: 'https://cdn.example/route.jpg',
    key: 'notes/route.jpg', requiredHeaders: {},
  });
  mockUploadFile.mockReturnValue(upload.promise);
  try {
    const rendered = render(<EditNoteScreen />);
    fireEvent.press(screen.getByText('notes.edit.addImage'));
    await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(1));

    mockRouteId = 'replacement-note';
    rendered.rerender(<EditNoteScreen />);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:route-pending'));
    rendered.unmount();
    expect(revokeObjectURL.mock.calls.filter(([uri]) => uri === 'blob:route-pending')).toHaveLength(1);
  } finally {
    upload.resolve();
    Object.defineProperty(global, 'window', { configurable: true, value: previousWindow });
    Object.defineProperty(global, 'URL', { configurable: true, value: previousURL });
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteId = undefined;
  mockFocusCallback = undefined;
  mockFocusCleanup = undefined;
  mockFetchNoteGroups.mockResolvedValue([]);
  mockFetchNoteDetail.mockResolvedValue({
    title: 'Replacement note', contentJson: [], media: [], sections: null, groups: [], pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  mockConsumePickedLocation.mockReturnValue(null);
  mockVideoPlayerRelease.mockClear();
  mockVideoThumbnailRelease.mockClear();
  mockGenerateThumbnails.mockResolvedValue([mockGeneratedVideoThumbnail]);
});

test('blurred uploads cannot alert over another route and focus restores usable media controls', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<EditNoteScreen />);
  const upload = await beginDeferredImageUpload();

  expect(locationAction().props.disabled).toBe(true);
  fireEvent.press(locationAction());
  expect(mockRouter.push).not.toHaveBeenCalled();

  act(() => mockFocusCleanup?.());
  await act(async () => {
    upload.reject(new Error('network failed'));
    await Promise.resolve();
  });
  expect(alert).not.toHaveBeenCalled();

  act(() => {
    const cleanup = mockFocusCallback?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
  expect(locationAction().props.disabled).toBe(false);
});

test('a route id change abandons the previous upload without keeping controls locked', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const rendered = render(<EditNoteScreen />);
  const upload = await beginDeferredImageUpload();

  mockRouteId = 'replacement-note';
  rendered.rerender(<EditNoteScreen />);
  await act(async () => {
    upload.reject(new Error('network failed'));
    await Promise.resolve();
  });

  expect(alert).not.toHaveBeenCalled();
  expect(locationAction().props.disabled).toBe(false);
});

test('a replacement route cannot submit note A data as note B before B loads', async () => {
  const replacement = createDeferred<{
    title: string;
    contentJson: never[];
    media: never[];
    sections: null;
    groups: never[];
    pinned: boolean;
    createdAt: string;
  }>();
  mockRouteId = 'note-a';
  mockFetchNoteDetail.mockImplementation((id: string) =>
    id === 'note-a'
      ? Promise.resolve({
          title: 'Note A', contentJson: [], media: [], sections: null, groups: [], pinned: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        })
      : replacement.promise,
  );
  jest.mocked(updateNote).mockResolvedValue({} as Awaited<ReturnType<typeof updateNote>>);
  const rendered = render(<EditNoteScreen />);
  await screen.findByDisplayValue('Note A');
  const upload = await beginDeferredImageUpload();

  mockRouteId = 'note-b';
  rendered.rerender(<EditNoteScreen />);
  await waitFor(() => expect(mockFetchNoteDetail).toHaveBeenCalledWith('note-b'));
  expect(screen.queryByText('notes.edit.done')).toBeNull();
  expect(updateNote).not.toHaveBeenCalled();

  await act(async () => {
    replacement.resolve({
      title: 'Note B', contentJson: [], media: [], sections: null, groups: [], pinned: false,
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    await replacement.promise;
  });
  await screen.findByDisplayValue('Note B');
  fireEvent.press(screen.getByText('notes.edit.done'));
  await waitFor(() => {
    expect(updateNote).toHaveBeenCalledWith(
      'note-b',
      expect.objectContaining({ title: 'Note B' }),
    );
  });
  upload.resolve();
});

test('a completed save cannot navigate away from a replacement note route', async () => {
  const save = createDeferred<Awaited<ReturnType<typeof updateNote>>>();
  mockRouteId = 'note-a';
  mockFetchNoteDetail.mockImplementation((noteId: string) =>
    Promise.resolve({
      title: noteId === 'note-a' ? 'Note A' : 'Note B',
      contentJson: [], media: [], sections: null, groups: [], pinned: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  );
  jest.mocked(updateNote).mockReturnValue(save.promise);
  const rendered = render(<EditNoteScreen />);
  await screen.findByDisplayValue('Note A');
  fireEvent.press(screen.getByText('notes.edit.done'));
  await waitFor(() => expect(updateNote).toHaveBeenCalledWith('note-a', expect.any(Object)));

  mockRouteId = 'note-b';
  rendered.rerender(<EditNoteScreen />);
  await screen.findByDisplayValue('Note B');

  await act(async () => {
    save.resolve({} as Awaited<ReturnType<typeof updateNote>>);
    await save.promise;
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(screen.getByText('notes.edit.done')).toBeTruthy();
});

test('a failed save cannot alert over a replacement note route', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const save = createDeferred<Awaited<ReturnType<typeof updateNote>>>();
  mockRouteId = 'note-a';
  mockFetchNoteDetail.mockImplementation((noteId: string) =>
    Promise.resolve({
      title: noteId === 'note-a' ? 'Note A' : 'Note B',
      contentJson: [], media: [], sections: null, groups: [], pinned: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  );
  jest.mocked(updateNote).mockReturnValue(save.promise);
  const rendered = render(<EditNoteScreen />);
  await screen.findByDisplayValue('Note A');
  fireEvent.press(screen.getByText('notes.edit.done'));
  await waitFor(() => expect(updateNote).toHaveBeenCalledWith('note-a', expect.any(Object)));

  mockRouteId = 'note-b';
  rendered.rerender(<EditNoteScreen />);
  await screen.findByDisplayValue('Note B');
  await act(async () => {
    save.reject(new Error('late save failure'));
    try {
      await save.promise;
    } catch {
      // The component owns the rejection; this await only drains the deferred promise.
    }
  });

  expect(alert).not.toHaveBeenCalled();
  expect(screen.getByText('notes.edit.done')).toBeTruthy();
});

test('renders a map-selected location as read-only details and clears the saved payload', async () => {
  mockRouteId = 'located-note';
  mockFetchNoteDetail.mockResolvedValue({
    title: 'Located note',
    contentJson: [],
    media: [],
    sections: {
      location: {
        title: 'Harbor Cafe',
        address: '1 Ocean Drive, Seaside',
        latitude: 37.7749,
        longitude: -122.4194,
      },
    },
    groups: [],
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  jest.mocked(updateNote).mockResolvedValue({} as Awaited<ReturnType<typeof updateNote>>);

  render(<EditNoteScreen />);
  await screen.findByDisplayValue('Located note');

  expect(screen.getByText('notes.edit.locationPlaceNameLabel')).toBeTruthy();
  expect(screen.getByText('Harbor Cafe')).toBeTruthy();
  expect(screen.getByText('notes.edit.locationAddressLabel')).toBeTruthy();
  expect(screen.getByText('1 Ocean Drive, Seaside')).toBeTruthy();
  expect(screen.queryByText('notes.edit.useCurrentLocation')).toBeNull();

  fireEvent.press(screen.getByText('notes.edit.clearLocation'));
  fireEvent.press(screen.getByText('notes.edit.done'));

  await waitFor(() => {
    expect(updateNote).toHaveBeenCalledWith(
      'located-note',
      expect.objectContaining({
        sections: expect.objectContaining({ location: null }),
      }),
    );
  });
});

test.each([
  ['latitude only', { latitude: 37.7749, longitude: null }],
  ['longitude only', { latitude: null, longitude: -122.4194 }],
])('keeps a legacy partial-coordinate location visible and clearable: %s', async (_label, coordinates) => {
  mockRouteId = 'partial-location-note';
  mockFetchNoteDetail.mockResolvedValue({
    title: 'Partial location note',
    contentJson: [],
    media: [],
    sections: {
      location: {
        title: null,
        address: null,
        ...coordinates,
      },
    },
    groups: [],
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  jest.mocked(updateNote).mockResolvedValue({} as Awaited<ReturnType<typeof updateNote>>);

  render(<EditNoteScreen />);
  await screen.findByDisplayValue('Partial location note');

  expect(screen.getByText('notes.edit.locationPlaceNameLabel')).toBeTruthy();
  expect(screen.getByText('notes.edit.locationAddressLabel')).toBeTruthy();
  const clearLocation = screen.getByLabelText('notes.edit.clearLocation');
  expect(clearLocation.props.accessibilityRole).toBe('button');

  fireEvent.press(clearLocation);
  fireEvent.press(screen.getByText('notes.edit.done'));

  await waitFor(() => {
    expect(updateNote).toHaveBeenCalledWith(
      'partial-location-note',
      expect.objectContaining({
        sections: expect.objectContaining({ location: null }),
      }),
    );
  });
});

test('saving a legacy URL-only showcase image retains its recovered ordinary media', async () => {
  const image = {
    id: 'stored-image',
    type: 'IMAGE' as const,
    objectKey: 'notes/legacy-image.jpg',
    url: 'https://cdn.example/legacy-image.jpg',
    mimeType: 'image/jpeg',
    size: 42,
    width: 640,
    height: 480,
    durationMs: null,
    posterUrl: null,
    sortOrder: 5,
  };
  mockRouteId = 'legacy-note';
  mockFetchNoteDetail.mockResolvedValue({
    title: 'Legacy note',
    contentJson: [{ type: 'image', props: { url: image.url } }],
    media: [image],
    sections: {
      showcase: { items: [{ type: 'IMAGE', url: image.url }] },
    },
    groups: [],
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  jest.mocked(updateNote).mockResolvedValue({} as Awaited<ReturnType<typeof updateNote>>);

  render(<EditNoteScreen />);
  await screen.findByDisplayValue('Legacy note');
  fireEvent.press(screen.getByText('notes.edit.done'));

  await waitFor(() => {
    expect(updateNote).toHaveBeenCalledWith(
      'legacy-note',
      expect.objectContaining({
        sections: expect.objectContaining({
          media: { items: [expect.objectContaining({ objectKey: image.objectKey, url: image.url })] },
          showcase: { items: [] },
        }),
        media: [expect.objectContaining({ objectKey: image.objectKey, url: image.url })],
      }),
    );
  });
});

test('stored videos without posters render a video fallback instead of an image URL', async () => {
  mockRouteId = 'video-without-poster';
  mockFetchNoteDetail.mockResolvedValue({
    title: 'Stored video',
    contentJson: [],
    media: [{
      id: 'video-1', type: 'VIDEO', objectKey: 'notes/video.mp4',
      url: 'https://cdn.example/video.mp4', posterUrl: null, sortOrder: 0,
    }],
    sections: {
      media: { items: [] },
      showcase: { items: [{
        id: 'video-1', type: 'VIDEO', objectKey: 'notes/video.mp4',
        url: 'https://cdn.example/video.mp4', posterUrl: null, sortOrder: 0,
      }] },
    },
    groups: [], pinned: false, createdAt: '2026-01-01T00:00:00.000Z',
  });

  render(<EditNoteScreen />);
  await screen.findByDisplayValue('Stored video');

  expect(screen.getByTestId('note-media-video-fallback')).toBeTruthy();
  expect(
    screen.queryAllByTestId('note-media-preview-image').some(
      (node) => node.props.source?.uri === 'https://cdn.example/video.mp4',
    ),
  ).toBe(false);
});

test('reports a redacted aggregate when a section upload batch partially fails', async () => {
  const uploadError = new Error('https://signed.example/private?token=secret');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///one.jpg' }, { uri: 'file:///two.jpg' }],
  });
  mockRequestPresign.mockImplementation(({ filename }: { filename: string }) =>
    Promise.resolve({
      uploadUrl: `https://upload.example/${filename}`,
      fileUrl: `https://cdn.example/${filename}`,
      key: `notes/${filename}`,
      requiredHeaders: {},
    }),
  );
  mockUploadFile.mockRejectedValueOnce(uploadError).mockResolvedValueOnce(undefined);

  render(<EditNoteScreen />);
  fireEvent.press(screen.getByText('notes.edit.addImage'));

  await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(2));
  expect(mockReportHandledFailure).toHaveBeenCalledWith(
    'noteEditor',
    'sectionMediaUploadBatch',
    expect.objectContaining({ message: 'note media batch upload failed' }),
    { failed: 1, total: 2, reason: 'media.image' },
  );
});

test('unrecoverable legacy media blocks save with an actionable warning', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockRouteId = 'unrecoverable-note';
  mockFetchNoteDetail.mockResolvedValue({
    title: 'Unrecoverable note',
    contentJson: [{ type: 'image', props: { url: 'https://removed.example/legacy.jpg' } }],
    media: [],
    sections: {
      showcase: { items: [{ type: 'IMAGE', url: 'https://removed.example/legacy.jpg' }] },
    },
    groups: [],
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  render(<EditNoteScreen />);
  await screen.findByDisplayValue('Unrecoverable note');
  fireEvent.press(screen.getByText('notes.edit.done'));

  expect(updateNote).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'notes.edit.legacyMediaUnavailableTitle',
    'notes.edit.legacyMediaUnavailableMessage',
  );
});

test('transitively aliased legacy media saves as one recovered ordinary item', async () => {
  const old = {
    id: 'ordinary',
    type: 'IMAGE' as const,
    objectKey: 'notes/photo.jpg',
    url: 'https://cdn.example.test/photo-old.jpg',
    mimeType: 'image/jpeg',
    size: null,
    width: null,
    height: null,
    durationMs: null,
    posterUrl: null,
    sortOrder: 0,
  };
  mockRouteId = 'alias-chain-note';
  mockFetchNoteDetail.mockResolvedValue({
    title: 'Alias chain note',
    contentJson: [],
    media: [old],
    sections: {
      showcase: {
        items: [
          {
            type: 'IMAGE',
            objectKey: old.objectKey,
            url: 'https://signed.example.test/photo-new.jpg',
            width: 640,
          },
          {
            type: 'IMAGE',
            url: 'https://signed.example.test/photo-new.jpg',
            height: 480,
          },
        ],
      },
    },
    groups: [],
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  jest.mocked(updateNote).mockResolvedValue({} as Awaited<ReturnType<typeof updateNote>>);

  render(<EditNoteScreen />);
  await screen.findByDisplayValue('Alias chain note');
  fireEvent.press(screen.getByText('notes.edit.done'));

  await waitFor(() => {
    expect(updateNote).toHaveBeenCalledWith(
      'alias-chain-note',
      expect.objectContaining({
        sections: expect.objectContaining({
          media: {
            items: [
              expect.objectContaining({
                objectKey: old.objectKey,
                url: old.url,
                width: 640,
                height: 480,
              }),
            ],
          },
          showcase: { items: [] },
        }),
      }),
    );
  });
});
