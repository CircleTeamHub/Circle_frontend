import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import EditNoteScreen, { draftRecordFromServer, draftFingerprint } from './EditNoteScreen';
import { VideoDraftPreview } from '@/features/notes/components/VideoDraftPreview';
import { createNote, updateNote } from '@/services/api/notes';
import { storage } from '@/storage';
import { usePreventRemove } from '@react-navigation/native';
import type { CreateNoteInput, NoteDetail, NoteDraftDetail } from '@/features/notes/types';
import { ApiError } from '@/services/api/api-error';

// EditNoteScreen reads the current account for local/server draft persistence.
// The real auth store hydrates through native encrypted storage, which is not
// available in the Jest host; the editor behavior tests do not need a session.
const mockDraftAuth: { user: null | { id: string; nickname: string }; sessionEpoch: number } = { user: null, sessionEpoch: 0 };
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (state: typeof mockDraftAuth) => unknown) => selector(mockDraftAuth), { getState: () => mockDraftAuth }),
}));

jest.mock('@/storage', () => ({
  storage: {
    getString: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    getBoolean: jest.fn(),
    contains: jest.fn(),
    clearAll: jest.fn(),
  },
  mmkvJsonStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ dispatch: jest.fn() }),
  usePreventRemove: jest.fn(),
}));

const mockRouter = { back: jest.fn(), push: jest.fn() };
const mockRequestPermission = jest.fn();
const mockLaunchPicker = jest.fn();
const mockRequestPresign = jest.fn();
const mockUploadFile = jest.fn();
const mockRecordingPermission = jest.fn();
const mockPersistRecording = jest.fn();
const mockRestoreRecording = jest.fn();
const mockRemoveRecording = jest.fn();
jest.mock('@/features/notes/utils/note-recording-storage', () => ({
  persistNoteRecording: (...args: unknown[]) => mockPersistRecording(...args),
  restoreNoteRecording: (...args: unknown[]) => mockRestoreRecording(...args),
  removeNoteRecording: (...args: unknown[]) => mockRemoveRecording(...args),
  isNoteRecordingId: (id: unknown) => typeof id === 'string' && /^recording-[a-z0-9-]{1,80}\.(m4a|webm)$/.test(id),
}));
const mockRecorder = {
  getStatus: jest.fn(() => ({ canRecord: true, durationMillis: 2400, url: 'file:///recording.m4a' })),
  prepareToRecordAsync: jest.fn(() => Promise.resolve()), record: jest.fn(),
  stop: jest.fn(() => Promise.resolve()), uri: 'file:///recording.m4a',
};
const mockPickerFriends = jest.fn();
const mockPickerCircles = jest.fn();
const mockCachedFriends = jest.fn();
const mockCachedCircles = jest.fn();
jest.mock('@/features/notes/utils/note-card-picker-cache', () => ({
  getCachedNotePickerFriends: (...args: unknown[]) => mockCachedFriends(...args),
  getCachedNotePickerCircles: (...args: unknown[]) => mockCachedCircles(...args),
  isNotePickerFriendsFresh: () => false, isNotePickerCirclesFresh: () => false,
  loadNotePickerFriends: (...args: unknown[]) => mockPickerFriends(...args),
  loadNotePickerCircles: (...args: unknown[]) => mockPickerCircles(...args),
  prefetchNoteCardPickerData: () => Promise.resolve(),
}));
const mockFetchNoteGroups = jest.fn();
const mockCreateNoteGroup = jest.fn();
const mockFetchNoteDetail = jest.fn();
const mockConsumePickedLocation = jest.fn();
const mockVideoThumbnailRelease = jest.fn();
const mockGeneratedVideoThumbnail = { nativeRefType: 'image', release: mockVideoThumbnailRelease };
const mockVideoPlayerRelease = jest.fn();
const mockGenerateThumbnails = jest.fn();
const mockReportHandledFailure = jest.fn();
let mockRouteId: string | undefined;
let mockRouteDraftId: string | undefined;
const mockFetchDraft = jest.fn();
const mockSaveDraft = jest.fn();
const mockDeleteDraft = jest.fn();
let mockFocusCallback: (() => void | (() => void)) | undefined;
let mockFocusCleanup: (() => void) | undefined;
let mockEditorProps: {
  initialContent: Record<string, unknown>[] | null;
  onContentChange: (blocks: Record<string, unknown>[]) => void;
  editable?: boolean;
} | undefined;
let mockEditorRenderCount = 0;
type MockTranslate = (key: string, options?: Record<string, unknown>) => string;
const identityTranslate: MockTranslate = (key) => key;
// 语言切换会换掉 t 的身份 —— 用例要能模拟这一点。
let mockTranslate: MockTranslate = identityTranslate;

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: mockRouteId, draftId: mockRouteDraftId }),
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

jest.mock('expo-audio', () => ({
  AudioQuality: { MEDIUM: 'medium' },
  IOSOutputFormat: { MPEG4AAC: 'aac' },
  requestRecordingPermissionsAsync: (...args: unknown[]) => mockRecordingPermission(...args),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  useAudioRecorder: () => mockRecorder,
}));

// 记录每一个 <Image> 的 source：位置预览那组断言关心的就是「渲染时有没有把
// 坐标交给第三方主机」，只有把 source 收集起来才看得见。
const imageSources: unknown[] = [];
jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    // props 保持 object：<View {...props} /> 只接受 ViewProps，收窄成
    // { source?: unknown } 会让这个展开在 tsc 下无重载可匹配。
    Image: (props: object) => {
      imageSources.push((props as { source?: unknown }).source);
      return <View {...props} />;
    },
  };
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
    resolvedMode: 'light',
    colors: {
      background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111',
      textSecondary: '#666', primary: '#6200ee', brandPurple: '#6200ee', white: '#fff',
      overlay: 'rgba(0,0,0,.4)', warning: '#f59e0b', danger: '#ef4444',
    },
  }),
}));

jest.mock('@/features/notes/components/NoteBlockEditor', () => ({
  NoteBlockEditor: (props: NonNullable<typeof mockEditorProps>) => {
    // 每次渲染都记一笔：正文每敲一个字就整屏重渲染的话，这个计数会跟着涨。
    mockEditorRenderCount += 1;
    mockEditorProps = props;
    return null;
  },
}));

jest.mock('@/features/notes/store/use-note-location-picker-store', () => ({
  useNoteLocationPickerStore: (selector: (state: unknown) => unknown) =>
    selector({ consumePickedLocation: mockConsumePickedLocation }),
}));

jest.mock('@/services/api/notes', () => ({
  createNote: jest.fn(),
  createNoteGroup: (...args: unknown[]) => mockCreateNoteGroup(...args),
  fetchNoteDraft: (...args: unknown[]) => mockFetchDraft(...args),
  saveNoteDraft: (...args: unknown[]) => mockSaveDraft(...args),
  deleteNoteDraft: (...args: unknown[]) => mockDeleteDraft(...args),
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

/** 保存请求里 media 分区的条目（断言上送了哪些字段）。 */
function createdNoteMediaItems() {
  const [input] = jest.mocked(createNote).mock.calls[0];
  return input.sections?.media?.items ?? [];
}

function locationAction() {
  let node = screen.getByText('notes.edit.pickLocation');
  while (node.parent && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node;
}

function pressComposer(kind: 'title' | 'text' | 'image' | 'video' | 'location') {
  // Title is a fixed field at the top of the editor, and image/video now share
  // the single multi-media action. Keep the older helper call sites readable
  // while targeting the current editor affordances. Every other action first
  // adds its block; the second tap exercises the block's own control.
  if (kind === 'title') return;
  const action = kind === 'video' || kind === 'image' ? 'media' : kind;
  fireEvent.press(screen.getByRole('button', { name: `notes.edit.composer.${action}` }));
  if (kind === 'image' || kind === 'video') {
    const addButtons = screen.getAllByRole('button', { name: 'notes.edit.addMedia' });
    fireEvent.press(addButtons[addButtons.length - 1]);
  } else if (kind === 'location') {
    fireEvent.press(locationAction());
  }
}

// The first editor interaction pays the cold-cache cost of loading the rich
// editor and composer modules; keep that cost out of Jest's default 5s budget.
test('allows repeated text blocks and reorders each instance independently', async () => {
  render(<EditNoteScreen />);

  pressComposer('text');
  pressComposer('text');
  await waitFor(() => expect(mockEditorRenderCount).toBeGreaterThanOrEqual(2));

  fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.sort' }));
  expect(screen.getByText('notes.edit.composer.text 1')).toBeTruthy();
  expect(screen.getByText('notes.edit.composer.text 2')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'common.close' }));
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), '可重复区块');
  fireEvent.press(screen.getByText('notes.edit.done'));
  await waitFor(() => expect(createNote).toHaveBeenCalled());
  const [input] = jest.mocked(createNote).mock.calls[0];
  const marker = input.contentJson?.find((block) => block.type === 'noteLayout') as
    | { props?: { blocks?: unknown } }
    | undefined;
  expect(marker?.props?.blocks).toEqual([
    { id: 'title-fixed', kind: 'title' },
    { id: 'text-1', kind: 'text' },
    { id: 'text-2', kind: 'text' },
  ]);
}, 20_000);

test('only adds singleton composer blocks once', async () => {
  render(<EditNoteScreen />);

  pressComposer('title');
  pressComposer('title');
  expect(screen.getAllByPlaceholderText('notes.edit.titlePlaceholder')).toHaveLength(1);

  pressComposer('location');
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
  pressComposer('location');
  fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.sort' }));
  // The toolbar label and the single sheet row are the only two occurrences.
  expect(screen.getAllByText('notes.edit.composer.location')).toHaveLength(2);
});

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

  pressComposer('image');
  await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(1));
  return upload;
}

// 本文件里第一条执行的用例：首次渲染才加载的那批模块（媒体选择器、缩略图、视频
// 预览）都算在它头上，冷缓存下会超过默认的 5 秒，热缓存下只要 0.3 秒。给它单独的
// 超时额度，而不是抬高全局 testTimeout —— 那会把别处真正的卡死一并藏掉。
test('keeps a selected video preview visible before and after its upload settles', async () => {
  const upload = createDeferred<void>();
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: [{ type: 'video', uri: 'file:///picked-video.mp4', duration: 1_000, width: 100, height: 80 }],
  });
  mockRequestPresign.mockResolvedValue({
    uploadUrl: 'https://upload.example/picked-video.mp4',
    fileUrl: 'https://cdn.example/picked-video.mp4',
    key: 'notes/picked-video.mp4',
    requiredHeaders: {},
  });
  mockUploadFile.mockReturnValue(upload.promise);

  render(<EditNoteScreen />);
  pressComposer('video');
  await screen.findByTestId('note-media-preview-video');
  expect(screen.getByTestId('note-media-preview-video').props.source).toBe(mockGeneratedVideoThumbnail);
  expect(mockVideoPlayerRelease).toHaveBeenCalledTimes(1);

  upload.resolve();
  await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('note-media-preview-video')).toBeTruthy();
}, 20_000);

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
  pressComposer('image');

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
    pressComposer('image');
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
    pressComposer('image');
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
      assets: [{ type: 'video', uri: 'blob:main-rejected', fileSize: 201 * 1024 * 1024 }],
    });
    const rejected = render(<EditNoteScreen />);
    pressComposer('video');
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:main-rejected'));
    rejected.unmount();

    mockLaunchPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'blob:main-failed' }] });
    mockRequestPresign.mockRejectedValueOnce(new Error('presign failed'));
    const failed = render(<EditNoteScreen />);
    pressComposer('image');
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
    pressComposer('image');
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
  jest.mocked(createNote).mockReset().mockImplementation(async (input) => noteResult(input));
  jest.mocked(updateNote).mockReset().mockImplementation(async (id, input) => noteResult(input, id));
  mockDraftAuth.user = null; mockDraftAuth.sessionEpoch = 0; mockRouteDraftId = undefined;
  mockFetchDraft.mockReset().mockRejectedValue(new Error('missing')); mockSaveDraft.mockReset().mockResolvedValue({}); mockDeleteDraft.mockReset().mockResolvedValue(undefined);
  jest.clearAllMocks();
  mockRecordingPermission.mockReset().mockResolvedValue({ granted: true });
  mockPersistRecording.mockReset().mockResolvedValue({ localRecordingId: 'recording-test.m4a', uri: 'file:///documents/recording-test.m4a' });
  mockRestoreRecording.mockReset().mockResolvedValue('file:///documents/recording-test.m4a');
  mockRemoveRecording.mockReset().mockResolvedValue(undefined);
  mockRecorder.prepareToRecordAsync.mockReset().mockResolvedValue(undefined);
  mockRecorder.record.mockReset();
  mockRecorder.stop.mockReset().mockResolvedValue(undefined);
  mockRecorder.uri = 'file:///recording.m4a';
  mockRecorder.getStatus.mockReset().mockImplementation(() => ({ canRecord: true, durationMillis: 2400, url: mockRecorder.uri }));
  jest.mocked(setAudioModeAsync).mockReset().mockResolvedValue(undefined);
  mockPickerFriends.mockReset().mockResolvedValue([]);
  mockPickerCircles.mockReset().mockResolvedValue([]);
  mockCachedFriends.mockReset().mockReturnValue(null);
  mockCachedCircles.mockReset().mockReturnValue(null);
  jest.mocked(storage.getString).mockReset();
  jest.mocked(storage.set).mockReset();
  jest.mocked(storage.remove).mockReset();
  imageSources.length = 0;
  mockTranslate = identityTranslate;
  mockRouteId = undefined;
  mockFocusCallback = undefined;
  mockFocusCleanup = undefined;
  mockEditorProps = undefined;
  mockEditorRenderCount = 0;
  mockFetchNoteGroups.mockResolvedValue([]);
  mockCreateNoteGroup.mockReset().mockResolvedValue({ id: 'new-group', name: 'New group', sortOrder: 0, noteCount: 0 });
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
  pressComposer('location');

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

// 一次上传是 presign + PUT，几十秒起步。这段时间里去选个位置、挑个分组，本页就
// 失去焦点 —— 而完成路径原本头一句就是查所有权、失去就 return，于是**已经传完**的
// 对象被整批丢掉：字节已经躺在对象存储里，用户等的那几十秒白等。
test('失焦期间传完的媒体，回到页面后仍然保存得出去', async () => {
  jest.mocked(createNote).mockImplementation(async (input) => noteResult(input));
  render(<EditNoteScreen />);
  const upload = await beginDeferredImageUpload();

  act(() => mockFocusCleanup?.());
  await act(async () => {
    upload.resolve();
    await Promise.resolve();
  });
  act(() => {
    const cleanup = mockFocusCallback?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });

  pressComposer('title');
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), '标题');
  fireEvent.press(screen.getByText('notes.edit.done'));

  await waitFor(() => {
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: expect.objectContaining({
          media: {
            items: [expect.objectContaining({ objectKey: 'notes/slow.jpg' })],
          },
        }),
      }),
    );
  });
  // notes/ 是私有目录：直连地址读不到，媒体只按 objectKey 上送。
  expect(createdNoteMediaItems()[0]).not.toHaveProperty('url');
});

test('presign 不返回 fileUrl 时，笔记媒体照常上传、预览并按 objectKey 保存', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(createNote).mockImplementation(async (input) => noteResult(input));
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///keyed.jpg', width: 100, height: 80 }],
  });
  // 后端对私有目录不再返回可直读的地址。
  mockRequestPresign.mockResolvedValue({
    uploadUrl: 'https://upload.example/keyed.jpg',
    fileUrl: null,
    key: 'notes/keyed.jpg',
    requiredHeaders: {},
  });
  mockUploadFile.mockResolvedValue(undefined);

  render(<EditNoteScreen />);
  pressComposer('image');
  await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(1));

  // 传完之后仍然看得见：远端没有能读的地址，缩略图继续用本地资源。
  await waitFor(() =>
    expect(
      screen
        .getAllByTestId('note-media-preview-image')
        .some((node) => node.props.source?.uri === 'file:///keyed.jpg'),
    ).toBe(true),
  );
  expect(alert).not.toHaveBeenCalled();
  expect(mockReportHandledFailure).not.toHaveBeenCalled();

  pressComposer('title');
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), '标题');
  fireEvent.press(screen.getByText('notes.edit.done'));

  await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
  const [input] = jest.mocked(createNote).mock.calls[0];
  const items = createdNoteMediaItems();
  expect(items).toHaveLength(1);
  expect(items[0]).toEqual(expect.objectContaining({ type: 'IMAGE', objectKey: 'notes/keyed.jpg' }));
  // 没有地址就不要编一个出来：url 整个字段都不上送。
  expect(items[0]).not.toHaveProperty('url');
  expect(input.media).toHaveLength(1);
  expect(input.media[0]).toEqual(expect.objectContaining({ objectKey: 'notes/keyed.jpg' }));
  expect(input.media[0]).not.toHaveProperty('url');
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
  jest.mocked(updateNote).mockImplementation(async (id, input) => noteResult(input, id));
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
  jest.mocked(updateNote).mockImplementation(async (id, input) => noteResult(input, id));

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

// 底图瓦片来自第三方主机。打开一篇存过位置的笔记就自动请求，等于把精确坐标 +
// 本机网络元数据交出去，而用户什么都没点。chat 的位置卡片早就定了规矩（见
// location-card.tsx 的注释与 location-card.spec.tsx）：显式点开才请求。
const MAP_LABEL = 'chat.location.showPreview';

// 断言「有没有向任何外部主机发图片请求」而不是盯某一个域名：修复前用的是
// staticmap.openstreetmap.de，修复后用共享瓦片助手的 basemaps.cartocdn.com，
// 只盯其中一个都会让这条断言在另一侧变成永久绿灯。
const remoteImageRequests = () =>
  imageSources.filter((source) => {
    const uri =
      typeof source === 'string'
        ? source
        : typeof (source as { uri?: unknown })?.uri === 'string'
          ? ((source as { uri: string }).uri)
          : '';
    return /^https?:\/\//.test(uri);
  });

function locatedNote() {
  return {
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
  };
}

function layoutMap() {
  fireEvent(screen.getByTestId('note-location-map'), 'layout', {
    nativeEvent: { layout: { width: 320, height: 126 } },
  });
}

describe('note location map preview', () => {
  it('requests no third-party map tile just by opening a note with a stored location', async () => {
    mockRouteId = 'located-note';
    mockFetchNoteDetail.mockResolvedValue(locatedNote());

    render(<EditNoteScreen />);
    await screen.findByDisplayValue('Located note');
    layoutMap();

    expect(remoteImageRequests()).toHaveLength(0);
  });

  // 收起地图不等于把「存的是哪儿」也藏起来：地点名和详细地址仍然要在。
  it('still shows the saved place while the map stays collapsed', async () => {
    mockRouteId = 'located-note';
    mockFetchNoteDetail.mockResolvedValue(locatedNote());

    render(<EditNoteScreen />);
    await screen.findByDisplayValue('Located note');

    expect(screen.getByText('Harbor Cafe')).toBeTruthy();
    expect(screen.getByText('1 Ocean Drive, Seaside')).toBeTruthy();
    expect(screen.getByText(MAP_LABEL)).toBeTruthy();
  });

  it('loads tiles only after the author asks for the map', async () => {
    mockRouteId = 'located-note';
    mockFetchNoteDetail.mockResolvedValue(locatedNote());

    render(<EditNoteScreen />);
    await screen.findByDisplayValue('Located note');
    layoutMap();
    expect(remoteImageRequests()).toHaveLength(0);

    fireEvent.press(screen.getByText(MAP_LABEL));

    expect(remoteImageRequests().length).toBeGreaterThan(0);
  });

  // 门禁的例外：坐标是本人刚在选点页选的，那一页已经拉过一整屏瓦片了。
  it('renders the map immediately for a location picked in this session', async () => {
    mockConsumePickedLocation.mockReturnValue({
      title: 'Harbor Cafe',
      address: '1 Ocean Drive, Seaside',
      latitude: 37.7749,
      longitude: -122.4194,
    });

    render(<EditNoteScreen />);
    pressComposer('location');
    await screen.findByText('Harbor Cafe');
    layoutMap();

    expect(screen.queryByText(MAP_LABEL)).toBeNull();
    expect(remoteImageRequests().length).toBeGreaterThan(0);
  });

  // 清掉位置要把同意也收回：下一个位置得重新点一次。
  it('collapses the map again once the location is cleared', async () => {
    mockConsumePickedLocation.mockReturnValue({
      title: 'Harbor Cafe',
      address: '1 Ocean Drive, Seaside',
      latitude: 37.7749,
      longitude: -122.4194,
    });

    render(<EditNoteScreen />);
    pressComposer('location');
    await screen.findByText('Harbor Cafe');
    layoutMap();
    expect(remoteImageRequests().length).toBeGreaterThan(0);

    fireEvent.press(screen.getByText('notes.edit.clearLocation'));
    imageSources.length = 0;

    expect(screen.queryByText('Harbor Cafe')).toBeNull();
    expect(remoteImageRequests()).toHaveLength(0);
  });

  it('offers no map affordance for a legacy location without usable coordinates', async () => {
    mockRouteId = 'partial-location-note';
    const note = locatedNote();
    note.sections.location.longitude = null as unknown as number;
    mockFetchNoteDetail.mockResolvedValue(note);

    render(<EditNoteScreen />);
    await screen.findByDisplayValue('Located note');
    layoutMap();

    expect(screen.queryByText(MAP_LABEL)).toBeNull();
    expect(remoteImageRequests()).toHaveLength(0);
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
  jest.mocked(updateNote).mockImplementation(async (id, input) => noteResult(input, id));

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
  jest.mocked(updateNote).mockImplementation(async (id, input) => noteResult(input, id));

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
  pressComposer('image');

  await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(2));
  // 签名里带上失败种类，让网络断 / 预签名 403 / 超时在聚合里分得开；
  // 但原始 message 一个字都不能带出去 —— 它整条带着预签名 URL 和令牌。
  expect(mockReportHandledFailure).toHaveBeenCalledWith(
    'noteEditor',
    'sectionMediaUploadBatch',
    expect.objectContaining({
      message: 'note media batch upload failed [Error]',
    }),
      { failed: 1, total: 2, reason: 'media.media', errorNames: 'Error' },
  );
  const reported = mockReportHandledFailure.mock.calls.find(
    (call: unknown[]) => call[1] === 'sectionMediaUploadBatch',
  );
  expect(JSON.stringify(reported)).not.toContain('signed.example');
  expect(JSON.stringify(String((reported?.[2] as Error)?.message))).not.toContain('token');
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

// 这些旧媒体渲染不出来也删不掉，所以「完成」被永久挡住。此前这件事只在点「完成」
// 时才弹一次 —— 作者已经改完标题和正文，才发现这篇笔记根本存不了。
test('无法恢复的旧媒体一进页面就给出警告，而不是等到点完成', async () => {
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

  expect(screen.getByTestId('note-unrecoverable-media-warning')).toBeTruthy();
});

test('没有无法恢复的旧媒体时不出现这条警告', async () => {
  mockRouteId = 'clean-note';
  mockFetchNoteDetail.mockResolvedValue({
    title: 'Clean note',
    contentJson: [],
    media: [],
    sections: { media: { items: [] }, showcase: { items: [] } },
    groups: [],
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  render(<EditNoteScreen />);
  await screen.findByDisplayValue('Clean note');

  expect(screen.queryByTestId('note-unrecoverable-media-warning')).toBeNull();
});

// t 在加载 effect 的依赖里时，切一次语言就会重跑整个 effect：setTitle('')、
// setMediaItems([]) 再重新拉服务端版本，作者没保存的编辑当场消失。
test('切换语言不会重新拉取笔记、冲掉未保存的编辑', async () => {
  mockRouteId = 'language-note';
  mockFetchNoteDetail.mockResolvedValue({
    title: 'Language note',
    contentJson: [],
    media: [],
    sections: { media: { items: [] }, showcase: { items: [] } },
    groups: [],
    pinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  const rendered = render(<EditNoteScreen />);
  await screen.findByDisplayValue('Language note');
  pressComposer('title');
  fireEvent.changeText(
    screen.getByPlaceholderText('notes.edit.titlePlaceholder'),
    '改了一半的标题',
  );
  expect(mockFetchNoteDetail).toHaveBeenCalledTimes(1);

  mockTranslate = (key: string) => `en:${key}`;
  rendered.rerender(<EditNoteScreen />);

  expect(mockFetchNoteDetail).toHaveBeenCalledTimes(1);
  expect(screen.getByDisplayValue('改了一半的标题')).toBeTruthy();
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
  jest.mocked(updateNote).mockImplementation(async (id, input) => noteResult(input, id));

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

test('empty and whitespace titles are rejected without an inline required hint', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(createNote).mockImplementation(async (input) => noteResult(input));
  render(<EditNoteScreen />);
  const done = screen.getByRole('button', { name: 'notes.edit.done' });
  expect(done).toBeEnabled();
  fireEvent.press(done);
  expect(alert).toHaveBeenCalledWith(
    'notes.edit.validationTitle', 'notes.edit.titleRequired', expect.any(Array),
  );
  expect(screen.queryByText('notes.edit.titleRequired')).toBeNull();
  expect(createNote).not.toHaveBeenCalled();

  pressComposer('title');
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), '   ');
  fireEvent.press(done);
  expect(createNote).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), '标题已补全');
  expect(screen.queryByText('notes.edit.titleRequired')).toBeNull();
  fireEvent.press(done);
  await waitFor(() => expect(createNote).toHaveBeenCalledWith(
    expect.objectContaining({ title: '标题已补全' }),
  ));
});

test('groups are selected from a bottom sheet instead of rendering every group inline', async () => {
  mockFetchNoteGroups.mockResolvedValue([
    { id: 'work', name: '工作', sortOrder: 0, noteCount: 2 },
    { id: 'travel', name: '旅行', sortOrder: 1, noteCount: 1 },
  ]);
  render(<EditNoteScreen />);

  await waitFor(() => expect(mockFetchNoteGroups).toHaveBeenCalled());
  expect(screen.queryByText('工作')).toBeNull();

  pressComposer('title');
  fireEvent.press(screen.getByRole('button', { name: 'notes.edit.groupsLabel' }));
  expect(screen.getByText('notes.groupPicker.title')).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: '工作' })).toBeTruthy();

  fireEvent.press(screen.getByRole('checkbox', { name: '工作' }));
  expect(screen.getAllByText('工作')).toHaveLength(2);

  fireEvent.press(screen.getByRole('button', { name: 'common.done' }));
  expect(screen.getAllByText('工作')).toHaveLength(1);
});

test('oversized pasted text stays editable, explains the limit, and saves in full after correction', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(createNote).mockImplementation(async (input) => noteResult(input));
  render(<EditNoteScreen />);
  pressComposer('title');
  pressComposer('text');
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), '长文');
  const text = '文'.repeat(20_000) + '末';
  act(() => mockEditorProps?.onContentChange([
    { type: 'paragraph', content: [{ type: 'text', text }] },
  ]));
  expect(screen.getByText('notes.edit.textTooLong')).toBeTruthy();
  fireEvent.press(screen.getByText('notes.edit.done'));
  expect(alert).toHaveBeenCalledWith('notes.edit.validationTitle', 'notes.edit.textTooLong');
  expect(createNote).not.toHaveBeenCalled();

  const corrected = '文'.repeat(19_998) + '末尾';
  act(() => mockEditorProps?.onContentChange([
    { type: 'paragraph', content: [{ type: 'text', text: corrected }] },
  ]));
  expect(screen.queryByText('notes.edit.textTooLong')).toBeNull();
  fireEvent.press(screen.getByText('notes.edit.done'));
  await waitFor(() => expect(createNote).toHaveBeenCalledWith(
    expect.objectContaining({ content: corrected }),
  ));
});

test('too many pasted paragraphs are explained before sending a save request', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const groups = createDeferred<never[]>();
  mockFetchNoteGroups.mockReturnValue(groups.promise);
  render(<EditNoteScreen />);
  await act(async () => { groups.resolve([]); });
  pressComposer('title');
  pressComposer('text');
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), '段落测试');
  act(() => mockEditorProps?.onContentChange(Array.from({ length: 501 }, () => ({
    type: 'paragraph', content: [{ type: 'text', text: '短段落' }],
  }))));
  fireEvent.press(screen.getByText('notes.edit.done'));
  expect(alert).toHaveBeenCalledWith('notes.edit.validationTitle', 'notes.edit.tooManyParagraphs');
  expect(createNote).not.toHaveBeenCalled();
});

test('editing a legacy plain-text note preserves the complete body when saving', async () => {
  mockRouteId = 'legacy-text-note';
  const text = '旧笔记正文\n'.repeat(400) + '最后一段';
  mockFetchNoteDetail.mockResolvedValue({
    title: '旧笔记', content: text, contentJson: null,
    media: [], sections: null, groups: [], pinned: false,
  });
  jest.mocked(updateNote).mockImplementation(async (id, input) => noteResult(input, id));
  render(<EditNoteScreen />);
  await waitFor(() => expect(mockEditorProps?.initialContent).toEqual([
    { type: 'paragraph', content: [{ type: 'text', text, styles: {} }] },
  ]));
  fireEvent.press(screen.getByText('notes.edit.done'));
  await waitFor(() => expect(updateNote).toHaveBeenCalledWith(
    'legacy-text-note', expect.objectContaining({ content: text }),
  ));
});

// contentJson 里躺着编辑器的默认文档（一个空段落）而正文在旧的 content 字段上，
// 是历史笔记最常见的形状。按「块数为 0」判断注入就会漏掉它：打开编辑器是空的，
// 点一下完成就把服务端那份正文清成了 null。
test('a legacy note whose contentJson is only an empty paragraph keeps its body', async () => {
  mockRouteId = 'empty-paragraph-note';
  const text = '第一段旧正文\n第二段旧正文';
  mockFetchNoteDetail.mockResolvedValue({
    title: '旧笔记',
    content: text,
    contentJson: [{ type: 'paragraph', content: [] }],
    media: [], sections: null, groups: [], pinned: false,
  });
  jest.mocked(updateNote).mockImplementation(async (id, input) => noteResult(input, id));
  render(<EditNoteScreen />);

  await waitFor(() => expect(mockEditorProps?.initialContent).toEqual([
    { type: 'paragraph', content: [{ type: 'text', text, styles: {} }] },
  ]));
  fireEvent.press(screen.getByText('notes.edit.done'));
  await waitFor(() => expect(updateNote).toHaveBeenCalledWith(
    'empty-paragraph-note', expect.objectContaining({ content: text }),
  ));
});

// 已经有正文的笔记不能被旧 content 字段盖掉：注入只在「块里一个字都没有」时发生。
test('a note with real rich text is never overwritten by the legacy content field', async () => {
  mockRouteId = 'rich-text-note';
  mockFetchNoteDetail.mockResolvedValue({
    title: '富文本笔记',
    content: '过期的纯文本快照',
    contentJson: [{ type: 'paragraph', content: [{ type: 'text', text: '编辑器里的正文' }] }],
    media: [], sections: null, groups: [], pinned: false,
  });
  render(<EditNoteScreen />);

  await waitFor(() => expect(mockEditorProps?.initialContent).toEqual([
    { type: 'paragraph', content: [{ type: 'text', text: '编辑器里的正文' }] },
  ]));
});

// 正文统计原来是 EditNoteScreen 的 state：每敲一个字整屏（分组 chip、媒体/展示
// 九宫格、地图预览）重渲染一次。计数要继续实时，但重渲染必须只发生在计数那一格。
test('typing in the body updates the live counter without re-rendering the screen', async () => {
  mockTranslate = (key, options) =>
    key === 'notes.edit.textCount' ? `字数:${options?.count}` : key;
  render(<EditNoteScreen />);
  pressComposer('text');
  await waitFor(() => expect(mockEditorProps).toBeDefined());

  const editorPropsBeforeTyping = mockEditorProps;
  const rendersBeforeTyping = mockEditorRenderCount;
  for (const text of ['一', '一二', '一二三']) {
    act(() => mockEditorProps?.onContentChange([
      { type: 'paragraph', content: [{ type: 'text', text }] },
    ]));
  }

  expect(screen.getByText('字数:3')).toBeTruthy();
  expect(mockEditorRenderCount).toBe(rendersBeforeTyping);
  expect(mockEditorProps).toBe(editorPropsBeforeTyping);
});


function noteResult(input: CreateNoteInput, id = 'saved-note'): NoteDetail {
  return { id, title: input.title.trim(), content: input.content || null, contentJson: input.contentJson ?? null,
    sections: input.sections, media: input.media.map((item, index) => ({ ...item, id: String(index), url: item.url ?? '',
      mimeType: item.mimeType ?? null, size: item.size ?? null, width: item.width ?? null, height: item.height ?? null,
      durationMs: item.durationMs ?? null, posterUrl: item.posterUrl ?? null })),
    groups: (input.groupIds ?? []).map((groupId) => ({ id: groupId, name: groupId })), pinned: input.pinned ?? false,
    status: input.status ?? 'ACTIVE', available: true, contentPreview: null, cover: null,
    imageCount: 0, videoCount: 0, mediaCount: input.media.length, createdAt: '', updatedAt: '' };
}

test('saving a pinned unlisted note preserves pinned and leaves status to the server', async () => {
  mockDraftAuth.user = { id: 'owner-a', nickname: 'A' };
  mockRouteId = 'existing-note';
  const note = { ...noteResult({ title: 'Existing unlisted note', contentJson: [], media: [], groupIds: [], pinned: true }, 'existing-note'), status: 'UNLISTED' as const };
  mockFetchNoteDetail.mockResolvedValue(note);
  jest.mocked(updateNote).mockImplementation(async (_id, input) => ({ ...noteResult(input, 'existing-note'), status: 'UNLISTED' }));
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('Existing unlisted note'));
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Edited title');
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1));
    const [id, input] = jest.mocked(updateNote).mock.calls[0];
    expect(id).toBe('existing-note');
    expect(input.pinned).toBe(true);
    expect(input.status).toBeUndefined();
    expect(input.title).toBe('Edited title');
    expect(createNote).not.toHaveBeenCalled();
    await waitFor(() => expect(mockDeleteDraft).toHaveBeenCalled());
  } finally { rendered.unmount(); }
});

function reviewDraft(overrides: Partial<NoteDraftDetail> = {}): NoteDraftDetail {
  return {
    id: 'review-draft', title: 'remote', content: null, contentJson: [], sections: null,
    contentPreview: null, mediaCount: 0, groupIds: [], mediaKeys: [],
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z', ...overrides,
  };
}

function signedInDraft() {
  mockDraftAuth.user = { id: 'owner-a', nickname: 'A' };
  mockRouteDraftId = 'review-draft';
}

test('server draft hydration restores each media region rather than combining them', () => {
  const record = draftRecordFromServer(reviewDraft({ sections: {
    text: { content: '', contentJson: [{ type: 'noteLayout', props: {
      blocks: [{ id: 'i1', kind: 'image' }, { id: 'i2', kind: 'image' }],
      mediaBlocks: [{ id: 'i1', target: 'media', objectKeys: ['one'] }, { id: 'i2', target: 'media', objectKeys: ['two'] }],
    } }] },
    media: { items: [{ type: 'IMAGE', objectKey: 'one', url: 'https://cdn/one', sortOrder: 0 }, { type: 'IMAGE', objectKey: 'two', url: 'https://cdn/two', sortOrder: 1 }] },
  } }), 'review-draft');
  expect(record.mediaOwnerByClientId[record.mediaItems[0].clientId]).toBe('i1');
  expect(record.mediaOwnerByClientId[record.mediaItems[1].clientId]).toBe('i2');
  const refreshed = { ...record, mediaItems: record.mediaItems.map((item) => ({ ...item, url: item.url + '?new-signature', clientId: 'new-' + item.clientId })),
    mediaOwnerByClientId: Object.fromEntries(Object.entries(record.mediaOwnerByClientId).map(([key, owner]) => ['new-' + key, owner])) };
  expect(draftFingerprint(refreshed)).toBe(draftFingerprint(record));
  expect(draftFingerprint({ ...refreshed, title: 'changed' })).not.toBe(draftFingerprint(record));
  const pending = { ...record, mediaItems: [{ ...record.mediaItems[0], objectKey: '', previewUri: 'file:///first.jpg' }] };
  expect(draftFingerprint({ ...pending, mediaItems: [{ ...pending.mediaItems[0], previewUri: 'file:///replacement.jpg' }] })).not.toBe(draftFingerprint(pending));
});

test.each([true, false])('draft hydration chooses the newest saved snapshot (remote newer: %s)', async (remoteNewer) => {
  signedInDraft();
  const local = draftRecordFromServer(reviewDraft({ title: 'local', updatedAt: remoteNewer ? '2026-10-05T00:00:00Z' : '2026-10-07T00:00:00Z' }), 'review-draft');
  jest.mocked(storage.getString).mockImplementation((key) => key.startsWith('circle-im-note-draft:v1:') ? JSON.stringify(local) : undefined);
  mockFetchDraft.mockResolvedValue(reviewDraft());
  render(<EditNoteScreen />);
  await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe(remoteNewer ? 'remote' : 'local'));
  expect(mockFetchDraft).toHaveBeenCalledWith('review-draft');
});

test('adding a region after restoring gapped IDs creates a distinct composer ID', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft({ contentJson: [{ type: 'noteLayout', props: {
    blocks: [{ id: 'text-1', kind: 'text' }, { id: 'text-3', kind: 'text' }],
    textBlocks: [{ id: 'text-1', content: [] }, { id: 'text-3', content: [] }],
  } }] }));
  render(<EditNoteScreen />);
  await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
  pressComposer('text');
  await waitFor(() => expect(mockSaveDraft).toHaveBeenCalled(), { timeout: 2500 });
  const input = mockSaveDraft.mock.calls.at(-1)?.[1];
  const ids = input.contentJson.find((block: { type: string }) => block.type === 'noteLayout').props.blocks.map((block: { id: string }) => block.id);
  expect(ids).toContain('text-4');
  expect(new Set(ids).size).toBe(ids.length);
});

test('save and exit stays in the editor when both local and server persistence fail', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  mockSaveDraft.mockRejectedValue(new Error('offline'));
  jest.mocked(storage.set).mockImplementation(() => { throw new Error('full'); });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'unsaved');
    const guard = jest.mocked(usePreventRemove).mock.calls.at(-1)?.[1];
    act(() => guard?.({ data: { action: { type: 'GO_BACK' } } } as never));
    const save = alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'notes.drafts.save');
    expect(save).toBeDefined();
    await act(async () => { save?.onPress?.(); await Promise.resolve(); });
    await waitFor(() => expect(alert).toHaveBeenCalledWith('common.errorOccurred', 'notes.drafts.saveFailed'));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('unsaved');
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test('queued autosave does not send old-account content after switching accounts', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  const pending = createDeferred<unknown>();
  mockSaveDraft.mockReturnValueOnce(pending.promise);
  const rendered = render(<EditNoteScreen />);
  await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'first-account-write');
  await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledTimes(1), { timeout: 2500 });
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'queued-old-content');
  await waitFor(() => expect(jest.mocked(storage.set).mock.calls.some(([, value]) => String(value).includes('queued-old-content'))).toBe(true), { timeout: 2500 });
  mockDraftAuth.user = { id: 'owner-b', nickname: 'B' }; mockDraftAuth.sessionEpoch += 1;
  rendered.rerender(<EditNoteScreen />);
  await act(async () => { pending.resolve({}); await pending.promise; });
  expect(mockSaveDraft.mock.calls.some(([, input]) => input.title === 'queued-old-content')).toBe(false);
  rendered.unmount();
});


test('reverting an autosaved edit writes the baseline back to the draft', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  render(<EditNoteScreen />);
  await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'temporary');
  await waitFor(() => expect(mockSaveDraft.mock.calls.some(([, input]) => input.title === 'temporary')).toBe(true), { timeout: 2500 });
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'remote');
  await waitFor(() => expect(mockSaveDraft.mock.calls.at(-1)?.[1].title).toBe('remote'), { timeout: 2500 });
});


test('keeps a stopped recording after presign failure and retries the same local file', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockRequestPresign.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
    uploadUrl: 'https://storage.test/upload', key: 'notes/owner-a/recording.m4a', requiredHeaders: {},
  });
  mockUploadFile.mockReset().mockResolvedValue(undefined);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.audio' }));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'notes.edit.done' })).toBeDisabled();
    await waitFor(() => expect(jest.mocked(storage.set).mock.calls.some(([, value]) => String(value).includes('recording-test.m4a'))).toBe(true), { timeout: 2500 });
    expect(jest.mocked(storage.set).mock.calls.some(([, value]) => String(value).includes('file:///recording.m4a'))).toBe(false);
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    expect(mockRecorder.record).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(mockRequestPresign).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull());
    expect(mockUploadFile.mock.calls.at(-1)?.[2]).toBe('file:///documents/recording-test.m4a');
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(createNote).toHaveBeenCalled());
    expect(jest.mocked(createNote).mock.calls.at(-1)?.[0].sections?.audio?.items[0].objectKey).toBe('notes/owner-a/recording.m4a');
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test('does not publish while audio recording is active', async () => {
  const rendered = render(<EditNoteScreen />);
  fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Recording');
  fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.audio' }));
  fireEvent.press(screen.getByText('notes.edit.startRecording'));
  await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
  const done = screen.getByRole('button', { name: 'notes.edit.done' });
  expect(done).toBeDisabled();
  fireEvent.press(done);
  expect(createNote).not.toHaveBeenCalled();
  expect(mockRouter.back).not.toHaveBeenCalled();
  rendered.unmount();
});

test.each(['contact', 'group'] as const)('clears %s picker rows and ignores the old response after switching accounts', async (kind) => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  const pending = createDeferred<unknown[]>();
  const load = kind === 'contact' ? mockPickerFriends : mockPickerCircles;
  load.mockReturnValueOnce(pending.promise).mockResolvedValue([]);
  const cached = kind === 'contact' ? mockCachedFriends : mockCachedCircles;
  cached.mockImplementation((id) => id === 'owner-a' ? [kind === 'contact'
    ? { id: 'friend-a', nickname: 'Private A', remark: '', accountId: 'a' }
    : { id: 'circle-a', name: 'Private A' }] : null);
  const rendered = render(<EditNoteScreen />);
  const open = () => {
    fireEvent.press(screen.getByRole('button', { name: `notes.edit.composer.${kind}` }));
    fireEvent.press(screen.getByText(kind === 'contact' ? 'notes.edit.addContact' : 'notes.edit.addGroup'));
  };
  await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
  open();
  await waitFor(() => expect(load).toHaveBeenCalledWith('owner-a'));
  mockDraftAuth.user = { id: 'owner-b', nickname: 'B' }; mockDraftAuth.sessionEpoch += 1;
  rendered.rerender(<EditNoteScreen />);
  await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
  open();
  await waitFor(() => expect(load).toHaveBeenCalledWith('owner-b'));
  await act(async () => { pending.resolve(kind === 'contact'
    ? [{ id: 'late-a', nickname: 'Late Private A', remark: '', accountId: 'a' }]
    : [{ id: 'late-a', name: 'Late Private A' }]); await pending.promise; });
  expect(screen.queryByText('Private A')).toBeNull();
  expect(screen.queryByText('Late Private A')).toBeNull();
  rendered.unmount();
});


test('a later edit of the same note uses a fresh draft lifecycle ID', async () => {
  mockRouteId = 'same-note';
  const submit = async () => {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('Replacement note'));
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Changed');
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(updateNote).toHaveBeenCalled());
    return jest.mocked(updateNote).mock.calls.at(-1)?.[1].clientDraftID;
  };
  const first = render(<EditNoteScreen />);
  const oldId = await submit(); first.unmount();
  jest.mocked(updateNote).mockClear();
  const second = render(<EditNoteScreen />);
  const newId = await submit(); second.unmount();
  expect(oldId).toBeTruthy(); expect(newId).toBeTruthy(); expect(newId).not.toBe(oldId);
});

test('a fresh editor hydrates without requesting an unknown generated draft ID', async () => {
  mockDraftAuth.user = { id: 'owner-a', nickname: 'A' };
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder')).toBeTruthy());
    expect(mockFetchDraft).not.toHaveBeenCalled();
  } finally { rendered.unmount(); }
});

test('a resumed draft gates editing and submission until its remote contents arrive', async () => {
  signedInDraft();
  const pending = createDeferred<NoteDraftDetail>();
  mockFetchDraft.mockReturnValueOnce(pending.promise);
  jest.mocked(createNote).mockImplementation(async (input) => noteResult(input));
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(mockFetchDraft).toHaveBeenCalledWith('review-draft'));
    expect(screen.queryByPlaceholderText('notes.edit.titlePlaceholder')).toBeNull();
    expect(screen.queryByRole('button', { name: 'notes.edit.done' })).toBeNull();
    expect(createNote).not.toHaveBeenCalled();
    const body = [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved body' }] }];
    await act(async () => {
      pending.resolve(reviewDraft({ sections: {
        text: { content: 'Saved body', contentJson: body },
        media: { items: [{ type: 'IMAGE', objectKey: 'notes/owner-a/saved.jpg', sortOrder: 0 }] },
      } }));
      await pending.promise;
    });
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    expect(mockEditorProps?.initialContent).toEqual(body);
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Edited after hydration');
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(createNote).toHaveBeenCalled());
    const input = jest.mocked(createNote).mock.calls.at(-1)?.[0];
    expect(input).toEqual(expect.objectContaining({ title: 'Edited after hydration', content: 'Saved body' }));
    expect(input?.sections?.media?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectKey: 'notes/owner-a/saved.jpg' }),
    ]));
  } finally { rendered.unmount(); }
});

test.each(['contentJson', 'sectionText'] as const)(
  'key-only media in a %s draft survives hydration and publication',
  async (source) => {
    signedInDraft();
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Draft body' }] },
      { type: 'image', props: { objectKey: 'notes/owner-a/photo.jpg', width: 800, height: 600 } },
      { type: 'video', props: { objectKey: 'notes/owner-a/video.mp4', durationMs: 2400 } },
    ];
    const draft = reviewDraft({
      mediaKeys: ['notes/owner-a/photo.jpg', 'notes/owner-a/video.mp4'],
      ...(source === 'contentJson' ? { contentJson: blocks } : {
        sections: { text: { content: 'Draft body', contentJson: blocks } },
      }),
    });
    const record = draftRecordFromServer(draft, 'review-draft');
    expect(record.mediaItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'IMAGE', objectKey: 'notes/owner-a/photo.jpg', width: 800, height: 600 }),
      expect.objectContaining({ type: 'VIDEO', objectKey: 'notes/owner-a/video.mp4', durationMs: 2400 }),
    ]));
    expect(Object.values(record.textBlocksById).flat()).toEqual([blocks[0]]);
    mockFetchDraft.mockResolvedValue(draft);
    jest.mocked(createNote).mockImplementation(async (input) => noteResult(input));
    const rendered = render(<EditNoteScreen />);
    try {
      await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
      fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
      await waitFor(() => expect(createNote).toHaveBeenCalled());
      const input = jest.mocked(createNote).mock.calls.at(-1)?.[0];
      expect(input?.sections?.media?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ objectKey: 'notes/owner-a/photo.jpg' }),
        expect.objectContaining({ objectKey: 'notes/owner-a/video.mp4' }),
      ]));
      expect(input?.content).toBe('Draft body');
    } finally { rendered.unmount(); }
  },
);

test.each(['contentJson', 'sectionText'] as const)(
  'draft hydration preserves nested children in %s text blocks',
  (source) => {
    const nested = { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }], children: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Child' }], children: [
        { type: 'image', props: { objectKey: 'notes/owner-a/nested.jpg', url: 'https://signed.test/nested.jpg' } },
      ] },
    ] };
    const record = draftRecordFromServer(reviewDraft(source === 'contentJson'
      ? { contentJson: [nested] }
      : { sections: { text: { content: 'Parent\nChild', contentJson: [nested] } } }), 'review-draft');
    expect(Object.values(record.textBlocksById).flat()).toEqual([nested]);
  },
);

test('Back keeps an active recording available until it is explicitly stopped', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  mockRequestPresign.mockReset().mockResolvedValue({
    uploadUrl: 'https://storage.test/upload', key: 'notes/owner-a/recording.m4a', requiredHeaders: {},
  });
  mockUploadFile.mockReset().mockResolvedValue(undefined);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.audio' }));
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Recording draft');
    // Once the region and title are autosaved, their fingerprint cannot warn about the recording.
    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalled(), { timeout: 2500 });
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    const guard = jest.mocked(usePreventRemove).mock.calls.at(-1)?.[1];
    act(() => guard?.({ data: { action: { type: 'GO_BACK' } } } as never));
    expect(alert).toHaveBeenCalledWith('notes.edit.waitForMediaTitle', 'notes.edit.waitForMediaMessage');
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRecorder.stop).not.toHaveBeenCalled();
    expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy();
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    await waitFor(() => expect(mockUploadFile).toHaveBeenCalled());
    expect(mockUploadFile.mock.calls.at(-1)?.[2]).toBe('file:///documents/recording-test.m4a');
    await waitFor(() => expect(jest.mocked(storage.set).mock.calls.some(([, value]) =>
      String(value).includes('notes/owner-a/recording.m4a'))).toBe(true), { timeout: 2500 });
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test.each(['account', 'sessionEpoch', 'route'] as const)(
  'a %s change stops the recorder before clearing its visible recording state',
  async (change) => {
    signedInDraft();
    mockFetchDraft.mockResolvedValue(reviewDraft());
    const rendered = render(<EditNoteScreen />);
    try {
      await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
      fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.audio' }));
      fireEvent.press(screen.getByText('notes.edit.startRecording'));
      await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
      if (change === 'route') {
        mockRouteId = 'replacement-note';
        mockRouteDraftId = undefined;
      } else {
        if (change === 'account') mockDraftAuth.user = { id: 'owner-b', nickname: 'B' };
        mockDraftAuth.sessionEpoch += 1;
      }
      rendered.rerender(<EditNoteScreen />);
      await waitFor(() => expect(mockRecorder.stop).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByText('notes.edit.stopRecording')).toBeNull());
      expect(mockRecorder.record).toHaveBeenCalledTimes(1);
      expect(mockRequestPresign).not.toHaveBeenCalled();
    } finally { rendered.unmount(); }
    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  },
);

test('deleting an audio region cancels a recording start whose native preparation is pending', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  const pending = createDeferred<void>();
  mockRecorder.prepareToRecordAsync.mockReturnValueOnce(pending.promise);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.audio' }));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalled());
    fireEvent.press(screen.getByRole('button', { name: 'notes.actions.deletenotes.edit.composer.audio' }));
    await act(async () => { pending.resolve(); await pending.promise; });
    await waitFor(() => expect(screen.getByRole('button', { name: 'notes.edit.done' })).toBeEnabled());
    expect(mockRecorder.record).not.toHaveBeenCalled();
    expect(screen.queryByText('notes.edit.stopRecording')).toBeNull();
  } finally {
    await act(async () => { pending.resolve(); await pending.promise; rendered.unmount(); });
  }
});

test.each(['prepare', 'stop'] as const)(
  'a new account waits for the previous recorder %s and stale cleanup cannot disable its recording',
  async (operation) => {
    signedInDraft();
    mockFetchDraft.mockResolvedValue(reviewDraft());
    const pending = createDeferred<void>();
    if (operation === 'prepare') mockRecorder.prepareToRecordAsync.mockReturnValueOnce(pending.promise);
    else mockRecorder.stop.mockReturnValueOnce(pending.promise);
    const rendered = render(<EditNoteScreen />);
    try {
      await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
      fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.audio' }));
      fireEvent.press(screen.getByText('notes.edit.startRecording'));
      if (operation === 'prepare') {
        await waitFor(() => expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledTimes(1));
      } else {
        await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
        fireEvent.press(screen.getByText('notes.edit.stopRecording'));
        await waitFor(() => expect(mockRecorder.stop).toHaveBeenCalledTimes(1));
      }
      mockDraftAuth.user = { id: 'owner-b', nickname: 'B' };
      mockDraftAuth.sessionEpoch += 1;
      rendered.rerender(<EditNoteScreen />);
      await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
      fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.audio' }));
      fireEvent.press(screen.getByText('notes.edit.startRecording'));
      await act(async () => { await Promise.resolve(); });
      expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
      expect(mockRecorder.record).toHaveBeenCalledTimes(operation === 'prepare' ? 0 : 1);
      await act(async () => { pending.resolve(); await pending.promise; });
      const recordedCount = operation === 'prepare' ? 1 : 2;
      await waitFor(() => expect(mockRecorder.record).toHaveBeenCalledTimes(recordedCount));
      expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy();
      const newRecordingOrder = mockRecorder.record.mock.invocationCallOrder[recordedCount - 1];
      jest.mocked(setAudioModeAsync).mock.calls.forEach(([mode], index) => {
        if (mode.allowsRecording === false) {
          expect(jest.mocked(setAudioModeAsync).mock.invocationCallOrder[index]).toBeLessThan(newRecordingOrder);
        }
      });
      expect(mockRequestPresign).not.toHaveBeenCalled();
    } finally {
      await act(async () => { pending.resolve(); await pending.promise; rendered.unmount(); });
    }
  },
);

test('a replacement audio region waits for the deleted region recorder to stop', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  const pending = createDeferred<void>();
  mockRecorder.stop.mockReturnValueOnce(pending.promise);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.audio' }));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'notes.actions.deletenotes.edit.composer.audio' }));
    await waitFor(() => expect(mockRecorder.stop).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.composer.audio' }));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await act(async () => { await Promise.resolve(); });
    expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
    expect(mockRecorder.record).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(); await pending.promise; });
    await waitFor(() => expect(mockRecorder.record).toHaveBeenCalledTimes(2));
    const newRecordingOrder = mockRecorder.record.mock.invocationCallOrder[1];
    jest.mocked(setAudioModeAsync).mock.calls.forEach(([mode], index) => {
      if (mode.allowsRecording === false) {
        expect(jest.mocked(setAudioModeAsync).mock.invocationCallOrder[index]).toBeLessThan(newRecordingOrder);
      }
    });
    expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy();
  } finally {
    await act(async () => { pending.resolve(); await pending.promise; rendered.unmount(); });
  }
});

test('a pending recording restores its current durable URI and retries after reopening the draft', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  const values = new Map<string, string>();
  jest.mocked(storage.set).mockImplementation((key, value) => { values.set(key, String(value)); });
  jest.mocked(storage.getString).mockImplementation((key) => values.get(key));
  mockRequestPresign.mockReset().mockRejectedValue(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const first = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
    await waitFor(() => expect([...values.values()].some((value) => value.includes('recording-test.m4a'))).toBe(true), { timeout: 2500 });
    expect([...values.values()].some((value) => value.includes('file:///'))).toBe(false);
  } finally { first.unmount(); }
  mockRestoreRecording.mockResolvedValue('file:///new-container/documents/recording-test.m4a');
  mockRequestPresign.mockReset().mockResolvedValue({ uploadUrl: 'https://storage.test/upload', key: 'notes/owner-a/resumed.m4a', requiredHeaders: {} });
  mockUploadFile.mockReset().mockResolvedValue(undefined);
  const second = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
    expect(mockRestoreRecording).toHaveBeenCalledWith('owner-a', 'recording-test.m4a');
    fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(mockUploadFile).toHaveBeenCalled());
    expect(mockUploadFile.mock.calls.at(-1)?.[2]).toBe('file:///new-container/documents/recording-test.m4a');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull());
  } finally { second.unmount(); alert.mockRestore(); }
});

test('failed recording storage and upload keep the playable item but cannot claim Save and Exit succeeded', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  mockPersistRecording.mockRejectedValue(new Error('full'));
  mockRequestPresign.mockReset().mockRejectedValue(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalled(), { timeout: 2500 });
    expect(jest.mocked(storage.set).mock.calls.some(([, value]) => String(value).includes('recording:'))).toBe(false);
    const guard = jest.mocked(usePreventRemove).mock.calls.at(-1)?.[1];
    act(() => guard?.({ data: { action: { type: 'GO_BACK' } } } as never));
    const choices = alert.mock.calls.at(-1)?.[2];
    act(() => choices?.find((button) => button.text === 'notes.drafts.save')?.onPress?.());
    await waitFor(() => expect(alert).toHaveBeenCalledWith('common.errorOccurred', 'notes.drafts.saveFailed'));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'notes.edit.done' })).toBeDisabled();
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test.each(['account', 'route'] as const)('a stale durable recording copy after a %s change cannot enter the replacement editor', async (change) => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  const pending = createDeferred<{ localRecordingId: string; uri: string }>();
  mockPersistRecording.mockReturnValueOnce(pending.promise);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    await waitFor(() => expect(mockPersistRecording).toHaveBeenCalledWith('owner-a', 'file:///recording.m4a'));
    if (change === 'account') { mockDraftAuth.user = { id: 'owner-b', nickname: 'B' }; mockDraftAuth.sessionEpoch += 1; }
    else { mockRouteId = 'replacement-note'; mockRouteDraftId = undefined; }
    rendered.rerender(<EditNoteScreen />);
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder')).toBeTruthy());
    await act(async () => { pending.resolve({ localRecordingId: 'recording-stale.m4a', uri: 'file:///documents/recording-stale.m4a' }); await pending.promise; });
    await waitFor(() => expect(mockRemoveRecording).toHaveBeenCalledWith('owner-a', 'recording-stale.m4a'));
    expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull();
    expect(mockRequestPresign).not.toHaveBeenCalled();
  } finally { await act(async () => { pending.resolve({ localRecordingId: 'recording-stale.m4a', uri: 'file:///documents/recording-stale.m4a' }); await pending.promise; rendered.unmount(); }); }
});

test('removing a recorded audio item cleans only its owned durable copy', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  mockRequestPresign.mockReset().mockRejectedValue(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
    fireEvent.press(screen.getByRole('button', { name: 'notes.actions.deletenotes.edit.audioItem' }));
    expect(mockRemoveRecording).toHaveBeenCalledWith('owner-a', 'recording-test.m4a');
    expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull();
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test.each(['account', 'route'] as const)('a deferred Save copy cannot persist the replacement editor after a %s change', async (change) => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  const pending = createDeferred<{ localRecordingId: string; uri: string }>();
  mockPersistRecording.mockRejectedValueOnce(new Error('full')).mockReturnValueOnce(pending.promise);
  mockRequestPresign.mockReset().mockRejectedValue(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    await waitFor(() => expect(mockPersistRecording).toHaveBeenCalledTimes(2), { timeout: 2500 });
    if (change === 'account') { mockDraftAuth.user = { id: 'owner-b', nickname: 'B' }; mockDraftAuth.sessionEpoch += 1; }
    else { mockRouteId = 'replacement-note'; mockRouteDraftId = undefined; }
    rendered.rerender(<EditNoteScreen />);
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder')).toBeTruthy());
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Replacement private content');
    await act(async () => { pending.resolve({ localRecordingId: 'recording-stale.m4a', uri: 'file:///documents/stale.m4a' }); await pending.promise; });
    await waitFor(() => expect(mockRemoveRecording).toHaveBeenCalledWith('owner-a', 'recording-stale.m4a'));
    expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('Replacement private content');
    expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull();
    expect(jest.mocked(storage.set).mock.calls.some(([key, value]) => key.includes('owner-a') && key.includes('review-draft') && String(value).includes('Replacement private content'))).toBe(false);
  } finally { await act(async () => { pending.resolve({ localRecordingId: 'recording-stale.m4a', uri: 'file:///documents/stale.m4a' }); await pending.promise; rendered.unmount(); }); alert.mockRestore(); }
});

test('successful upload remains publishable when the durable recording copy fails', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  mockPersistRecording.mockRejectedValue(new Error('full'));
  mockRequestPresign.mockReset().mockResolvedValue({ uploadUrl: 'https://storage.test/upload', key: 'notes/owner-a/uploaded.m4a', requiredHeaders: {} });
  mockUploadFile.mockReset().mockResolvedValue(undefined);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    await waitFor(() => expect(mockUploadFile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'notes.edit.done' })).toBeEnabled());
    await waitFor(() => expect(jest.mocked(storage.set).mock.calls.some(([, value]) => String(value).includes('notes/owner-a/uploaded.m4a'))).toBe(true), { timeout: 2500 });
    expect(jest.mocked(storage.set).mock.calls.some(([, value]) => String(value).includes('file:///recording.m4a'))).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(createNote).toHaveBeenCalled());
    expect(jest.mocked(createNote).mock.calls.at(-1)?.[0].sections?.audio?.items[0].objectKey).toBe('notes/owner-a/uploaded.m4a');
  } finally { rendered.unmount(); }
});

test.each(['unmount', 'account', 'route', 'remove'] as const)('a restored recording Blob URL stays active until %s and is then revoked once', async (change) => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  const record = { ...draftRecordFromServer(reviewDraft(), 'review-draft'), audioItems: [{
    type: 'AUDIO', objectKey: '', clientId: 'recording:restored', localRecordingId: 'recording-restored.webm', uploadStatus: 'PENDING', sortOrder: 0,
  }] };
  jest.mocked(storage.getString).mockImplementation((key) => key.includes('owner-a') && key.includes('review-draft') ? JSON.stringify(record) : undefined);
  mockRestoreRecording.mockResolvedValue('blob:restored-recording');
  const previousWindow = global.window;
  const previousURL = global.URL;
  const revokeObjectURL = jest.fn();
  Object.defineProperty(global, 'window', { configurable: true, value: {} });
  Object.defineProperty(global, 'URL', { configurable: true, value: { revokeObjectURL } });
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
    expect(revokeObjectURL).not.toHaveBeenCalled();
    if (change === 'account') { mockDraftAuth.user = { id: 'owner-b', nickname: 'B' }; mockDraftAuth.sessionEpoch += 1; rendered.rerender(<EditNoteScreen />); }
    else if (change === 'route') { mockRouteId = 'replacement-note'; mockRouteDraftId = undefined; rendered.rerender(<EditNoteScreen />); }
    else if (change === 'remove') fireEvent.press(screen.getByRole('button', { name: 'notes.actions.deletenotes.edit.audioItem' }));
    else rendered.unmount();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:restored-recording'));
    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  } finally { rendered.unmount(); Object.defineProperty(global, 'window', { configurable: true, value: previousWindow }); Object.defineProperty(global, 'URL', { configurable: true, value: previousURL }); }
});

test('a restored Blob from stale hydration is revoked without entering the new account', async () => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  const record = { ...draftRecordFromServer(reviewDraft(), 'review-draft'), audioItems: [{
    type: 'AUDIO', objectKey: '', clientId: 'recording:restored', localRecordingId: 'recording-restored.webm', uploadStatus: 'PENDING', sortOrder: 0,
  }] };
  jest.mocked(storage.getString).mockImplementation((key) => key.includes('owner-a') && key.includes('review-draft') ? JSON.stringify(record) : undefined);
  const pending = createDeferred<string>();
  mockRestoreRecording.mockReturnValueOnce(pending.promise);
  const previousWindow = global.window;
  const previousURL = global.URL;
  const revokeObjectURL = jest.fn();
  Object.defineProperty(global, 'window', { configurable: true, value: {} });
  Object.defineProperty(global, 'URL', { configurable: true, value: { revokeObjectURL } });
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(mockRestoreRecording).toHaveBeenCalled());
    mockDraftAuth.user = { id: 'owner-b', nickname: 'B' }; mockDraftAuth.sessionEpoch += 1;
    rendered.rerender(<EditNoteScreen />);
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder')).toBeTruthy());
    await act(async () => { pending.resolve('blob:stale-hydration'); await pending.promise; });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:stale-hydration');
    expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull();
  } finally { await act(async () => { pending.resolve('blob:stale-hydration'); await pending.promise; rendered.unmount(); }); Object.defineProperty(global, 'window', { configurable: true, value: previousWindow }); Object.defineProperty(global, 'URL', { configurable: true, value: previousURL }); }
});

test.each(['discard', 'publish'] as const)('%s cleans a durable recording that has not reached local draft autosave', async (action) => {
  signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft());
  mockRequestPresign.mockReset();
  if (action === 'discard') mockRequestPresign.mockRejectedValue(new Error('offline'));
  else mockRequestPresign.mockResolvedValue({ uploadUrl: 'https://storage.test/upload', key: 'notes/owner-a/uploaded.m4a', requiredHeaders: {} });
  mockUploadFile.mockReset().mockResolvedValue(undefined);
  jest.mocked(createNote).mockImplementation(async (input) => noteResult(input));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    if (action === 'discard') {
      await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
      expect(jest.mocked(storage.set).mock.calls.some(([, value]) => String(value).includes('recording-test.m4a'))).toBe(false);
      const guard = jest.mocked(usePreventRemove).mock.calls.at(-1)?.[1];
      act(() => guard?.({ data: { action: { type: 'GO_BACK' } } } as never));
      act(() => alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'notes.drafts.discard')?.onPress?.());
    } else {
      await waitFor(() => expect(screen.getByRole('button', { name: 'notes.edit.done' })).toBeEnabled());
      expect(jest.mocked(storage.set).mock.calls.some(([, value]) => String(value).includes('recording-test.m4a'))).toBe(false);
      fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
      await waitFor(() => expect(createNote).toHaveBeenCalled());
    }
    await waitFor(() => expect(mockRemoveRecording).toHaveBeenCalledWith('owner-a', 'recording-test.m4a'));
  } finally { rendered.unmount(); alert.mockRestore(); }
});

function installStatefulWebRecorder(prepareGate?: ReturnType<typeof createDeferred<void>>, stopGate?: ReturnType<typeof createDeferred<void>>) {
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
  const previousWindow = global.window;
  const previousURL = global.URL;
  const revokeObjectURL = jest.fn();
  const outputs: string[] = [];
  const resources: { trackStopped: boolean; listenerRemoved: boolean }[] = [];
  let state: 'empty' | 'inactive' | 'recording' = 'empty';
  let preparedCount = 0;
  let inactiveStopFailures = 0;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Object.defineProperty(global, 'window', { configurable: true, value: {} });
  Object.defineProperty(global, 'URL', { configurable: true, value: { revokeObjectURL } });
  mockRecorder.getStatus.mockImplementation(() => ({ canRecord: state !== 'empty', isRecording: state === 'recording', durationMillis: 2400, url: mockRecorder.uri }));
  mockRecorder.prepareToRecordAsync.mockImplementation(async () => {
    if (++preparedCount === 1 && prepareGate) await prepareGate.promise;
    // A new stream may only be acquired after the previous stop event released
    // its stream and devicechange listener, not merely after dataavailable.
    expect(resources.every((resource) => resource.trackStopped && resource.listenerRemoved)).toBe(true);
    resources.push({ trackStopped: false, listenerRemoved: false });
    state = 'inactive';
  });
  mockRecorder.record.mockImplementation(() => {
    if (state !== 'inactive') throw new Error('InvalidStateError');
    state = 'recording';
  });
  mockRecorder.stop.mockImplementation(async () => {
    if (state === 'inactive') { inactiveStopFailures += 1; throw new Error('InvalidStateError'); }
    if (state !== 'recording') throw new Error('No MediaRecorder');
    const resource = resources.at(-1)!;
    state = 'empty';
    if (stopGate) await stopGate.promise;
    mockRecorder.uri = `blob:stopped-recording-${outputs.length}`;
    outputs.push(mockRecorder.uri);
    // Installed Expo creates its URL at dataavailable; tracks and devicechange
    // listener are released by MediaRecorder's following stop event.
    setTimeout(() => { resource.trackStopped = true; resource.listenerRemoved = true; }, 0);
  });
  mockPersistRecording.mockImplementation(async (_owner: string, uri: string) => ({ localRecordingId: 'recording-web.webm', uri }));
  return { outputs, resources, revokeObjectURL, inactiveStopFailures: () => inactiveStopFailures,
    restore: () => {
      if (platformDescriptor) Object.defineProperty(Platform, 'OS', platformDescriptor);
      Object.defineProperty(global, 'window', { configurable: true, value: previousWindow });
      Object.defineProperty(global, 'URL', { configurable: true, value: previousURL });
    },
  };
}

function changeRecordingContext(change: 'account' | 'route' | 'unmount' | 'remove', rendered: ReturnType<typeof render>) {
  if (change === 'account') { mockDraftAuth.user = { id: 'owner-b', nickname: 'B' }; mockDraftAuth.sessionEpoch += 1; rendered.rerender(<EditNoteScreen />); }
  else if (change === 'route') { mockRouteId = 'replacement-note'; mockRouteDraftId = undefined; rendered.rerender(<EditNoteScreen />); }
  else if (change === 'unmount') rendered.unmount();
  else fireEvent.press(screen.getByRole('button', { name: 'notes.actions.deletenotes.edit.composer.audio' }));
}

test.each(['account', 'route', 'unmount', 'remove'] as const)('cancelled web preparation after %s releases microphone and listener and discards its output before the next start', async (change) => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft());
  const prepare = createDeferred<void>();
  const web = installStatefulWebRecorder(prepare);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledTimes(1));
    changeRecordingContext(change, rendered);
    if (change === 'account') {
      await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder')).toBeTruthy());
      fireEvent.press(screen.getByText('notes.edit.startRecording'));
      expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
    }
    await act(async () => { prepare.resolve(); await prepare.promise; });
    await waitFor(() => expect(web.resources[0]?.trackStopped).toBe(true));
    await waitFor(() => expect(web.revokeObjectURL.mock.calls.filter(([uri]) => uri === web.outputs[0])).toHaveLength(1));
    expect(web.resources[0].listenerRemoved).toBe(true);
    expect(web.inactiveStopFailures()).toBe(0);
    expect(web.outputs).toHaveLength(1);
    expect(web.revokeObjectURL.mock.calls.filter(([uri]) => uri === web.outputs[0])).toHaveLength(1);
    expect(mockPersistRecording).not.toHaveBeenCalled();
    if (change === 'account') {
      await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
      expect(web.resources[1].trackStopped).toBe(false);
      expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledTimes(2);
    }
  } finally {
    await act(async () => { prepare.resolve(); await prepare.promise; rendered.unmount(); });
    await waitFor(() => expect(web.resources.every((resource) => resource.trackStopped && resource.listenerRemoved)).toBe(true));
    web.restore();
  }
});

test.each(['account', 'route', 'unmount', 'remove'] as const)('a deferred explicit web stop discarded after %s revokes its output once', async (change) => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft());
  const stop = createDeferred<void>();
  const web = installStatefulWebRecorder(undefined, stop);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    await waitFor(() => expect(mockRecorder.stop).toHaveBeenCalledTimes(1));
    changeRecordingContext(change, rendered);
    expect(web.revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => { stop.resolve(); await stop.promise; });
    await waitFor(() => expect(web.revokeObjectURL).toHaveBeenCalledWith('blob:stopped-recording-0'));
    expect(web.resources[0].trackStopped).toBe(true);
    expect(web.resources[0].listenerRemoved).toBe(true);
    expect(web.outputs).toHaveLength(1);
    expect(web.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(mockPersistRecording).not.toHaveBeenCalled();
    expect(mockRequestPresign).not.toHaveBeenCalled();
  } finally { await act(async () => { stop.resolve(); await stop.promise; rendered.unmount(); }); web.restore(); }
});

test.each(['account', 'route', 'unmount', 'remove'] as const)('active web recording cleanup after %s waits for stop, releases capture and revokes its discarded output', async (change) => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft());
  const stop = createDeferred<void>();
  const web = installStatefulWebRecorder(undefined, stop);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    changeRecordingContext(change, rendered);
    await waitFor(() => expect(mockRecorder.stop).toHaveBeenCalledTimes(1));
    expect(web.revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => { stop.resolve(); await stop.promise; });
    await waitFor(() => expect(web.revokeObjectURL).toHaveBeenCalledWith('blob:stopped-recording-0'));
    expect(web.resources[0].trackStopped).toBe(true);
    expect(web.resources[0].listenerRemoved).toBe(true);
    expect(web.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(mockPersistRecording).not.toHaveBeenCalled();
  } finally { await act(async () => { stop.resolve(); await stop.promise; rendered.unmount(); }); web.restore(); }
});

test('accepted web stop output remains available for durable save and upload retry until the item is removed', async () => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft());
  const web = installStatefulWebRecorder();
  mockRequestPresign.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ uploadUrl: 'https://storage.test/upload', key: 'notes/owner-a/web.webm', requiredHeaders: {} });
  mockUploadFile.mockReset().mockResolvedValue(undefined);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByText('notes.edit.startRecording'));
    await waitFor(() => expect(screen.getByText('notes.edit.stopRecording')).toBeTruthy());
    fireEvent.press(screen.getByText('notes.edit.stopRecording'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
    expect(web.resources[0].trackStopped).toBe(true);
    expect(web.resources[0].listenerRemoved).toBe(true);
    expect(web.revokeObjectURL).not.toHaveBeenCalled();
    expect(mockPersistRecording).toHaveBeenCalledWith('owner-a', 'blob:stopped-recording-0');
    fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(mockUploadFile).toHaveBeenCalled());
    expect(mockUploadFile.mock.calls.at(-1)?.[2]).toBe('blob:stopped-recording-0');
    expect(web.revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'notes.actions.deletenotes.edit.audioItem' }));
    expect(web.revokeObjectURL).toHaveBeenCalledWith('blob:stopped-recording-0');
    expect(web.revokeObjectURL).toHaveBeenCalledTimes(1);
  } finally { rendered.unmount(); alert.mockRestore(); web.restore(); }
});

function durableDraftStorage() {
  const values = new Map<string, string>();
  jest.mocked(storage.set).mockImplementation((key, value) => { values.set(key, String(value)); });
  jest.mocked(storage.getString).mockImplementation((key) => values.get(key));
  jest.mocked(storage.remove).mockImplementation((key) => values.delete(key));
  return values;
}
function storedReviewDraft(values: Map<string, string>) {
  const value = [...values.entries()].find(([key]) => key.startsWith('circle-im-note-draft:v1:') && key.endsWith(':review-draft'))?.[1];
  return value ? JSON.parse(value) as { title: string; pendingSubmission?: { noteId: string | null; input: CreateNoteInput } } : undefined;
}

test.each(['POST', 'PATCH'] as const)('an ambiguous %s freezes keyboard/DOM edits and retries the durably stored original write', async (method) => {
  signedInDraft();
  if (method === 'PATCH') mockRouteId = 'existing-note';
  mockFetchDraft.mockResolvedValue(reviewDraft({ contentJson: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body', styles: {} }] }] }));
  const values = durableDraftStorage();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let committed: NoteDetail;
  if (method === 'POST') jest.mocked(createNote).mockImplementationOnce(async (input) => { committed = noteResult(input); throw new Error('response failed after commit'); }).mockImplementationOnce(async () => committed);
  else jest.mocked(updateNote).mockImplementationOnce(async (id, input) => { committed = noteResult(input, id); throw new Error('response failed after commit'); }).mockImplementationOnce(async () => committed);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'), { timeout: 5000 });
    const staleDOMChange = mockEditorProps!.onContentChange;
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Committed title');
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(screen.getByText('notes.edit.pendingSubmitMessage')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
    expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.editable).toBe(false);
    expect(mockEditorProps?.editable).toBe(false);
    act(() => {
      screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.onChangeText('Must not overwrite');
      staleDOMChange([{ type: 'paragraph', content: [{ type: 'text', text: 'Late keyboard input', styles: {} }] }]);
    });
    pressComposer('image');
    expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('Committed title');
    expect(storedReviewDraft(values)?.pendingSubmission?.input.title).toBe('Committed title');
    expect(JSON.stringify(storedReviewDraft(values))).not.toContain('Late keyboard input');
    expect(mockDeleteDraft).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(mockDeleteDraft).toHaveBeenCalledWith('review-draft'));
    const inputs = method === 'POST' ? jest.mocked(createNote).mock.calls.map(([input]) => input) : jest.mocked(updateNote).mock.calls.map(([, input]) => input);
    expect(inputs).toHaveLength(2); expect(inputs[1]).toEqual(inputs[0]);
    expect(storedReviewDraft(values)).toBeUndefined();
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test.each(['POST', 'PATCH'] as const)('a pending %s survives safe exit/restart and resumes before remote hydration', async (method) => {
  signedInDraft(); if (method === 'PATCH') mockRouteId = 'existing-note';
  mockFetchDraft.mockResolvedValue(reviewDraft()); const values = durableDraftStorage();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  if (method === 'POST') jest.mocked(createNote).mockRejectedValueOnce(new Error('timeout'));
  else jest.mocked(updateNote).mockRejectedValueOnce(new Error('timeout'));
  const first = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Pending saved snapshot');
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
    const guard = jest.mocked(usePreventRemove).mock.calls.at(-1)?.[1];
    act(() => guard?.({ data: { action: { type: 'GO_BACK' } } } as never));
    await waitFor(() => expect(jest.mocked(usePreventRemove).mock.calls.at(-1)?.[0]).toBe(false));
    expect(mockDeleteDraft).not.toHaveBeenCalled(); expect(storedReviewDraft(values)?.pendingSubmission?.input.title).toBe('Pending saved snapshot');
  } finally { first.unmount(); }
  mockFetchDraft.mockClear().mockResolvedValue(reviewDraft({ title: 'Newer remote', updatedAt: '2099-01-01' })); mockFetchNoteDetail.mockClear();
  const second = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('Pending saved snapshot'));
    expect(mockFetchDraft).not.toHaveBeenCalled(); expect(mockFetchNoteDetail).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.editable).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(mockDeleteDraft).toHaveBeenCalledWith('review-draft'));
  } finally { second.unmount(); alert.mockRestore(); }
});

test('a submission is never sent when the durable pending snapshot cannot be stored', async () => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft()); const values = durableDraftStorage();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    jest.mocked(storage.set).mockImplementationOnce(() => { throw new Error('storage full'); });
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('notes.edit.saveFailedTitle', 'notes.edit.pendingSubmitStorageFailed'));
    expect(createNote).not.toHaveBeenCalled(); expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.editable).toBe(true);
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Corrected before any request');
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(mockDeleteDraft).toHaveBeenCalled()); expect(jest.mocked(createNote).mock.calls[0][0].title).toBe('Corrected before any request');
    expect(storedReviewDraft(values)).toBeUndefined();
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test('a complete HTTP 400 rejection clears pending durably and permits correction with the unconsumed ID', async () => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft()); const values = durableDraftStorage();
  jest.mocked(createNote).mockRejectedValueOnce(new ApiError('Invalid input', { status: 400, failureKind: 'http' }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.editable).toBe(true); expect(storedReviewDraft(values)?.pendingSubmission).toBeUndefined();
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Corrected input'); fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(mockDeleteDraft).toHaveBeenCalled()); expect(jest.mocked(createNote).mock.calls.map(([input]) => input.clientDraftID)).toEqual(['review-draft', 'review-draft']);
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test.each(['conflict', 'different-replay'] as const)('%s keeps the pending draft and exposes a safe path to the saved note', async (failure) => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft()); const values = durableDraftStorage();
  if (failure === 'conflict') jest.mocked(createNote).mockRejectedValueOnce(new ApiError('Consumed', { status: 409, failureKind: 'http' }));
  else jest.mocked(createNote).mockImplementationOnce(async (input) => noteResult({ ...input, title: 'Different committed title' }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled());
    expect(storedReviewDraft(values)?.pendingSubmission).toBeTruthy(); expect(mockDeleteDraft).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
    if (failure === 'different-replay') {
      expect(screen.getByText('notes.edit.pendingSubmitConflict')).toBeTruthy();
      fireEvent.press(screen.getByRole('button', { name: 'notes.edit.openCommittedNote' }));
      await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/profile/notes/[id]', params: { id: 'saved-note' } }));
      expect(storedReviewDraft(values)?.pendingSubmission).toBeTruthy();
    }
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test('an old account submit result cannot delete its recovery snapshot or lock the next account editor', async () => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft()); const values = durableDraftStorage(); const gate = createDeferred<NoteDetail>();
  jest.mocked(createNote).mockReturnValueOnce(gate.promise); const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' })); await waitFor(() => expect(createNote).toHaveBeenCalled());
    const oldInput = jest.mocked(createNote).mock.calls[0][0]; mockDraftAuth.user = { id: 'owner-b', nickname: 'B' }; mockDraftAuth.sessionEpoch += 1; mockRouteDraftId = undefined; rendered.rerender(<EditNoteScreen />);
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe(''));
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'New account content');
    await act(async () => { gate.resolve(noteResult(oldInput)); await gate.promise; });
    expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('New account content'); expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.editable).toBe(true);
    expect(storedReviewDraft(values)?.pendingSubmission).toBeTruthy(); expect(mockDeleteDraft).not.toHaveBeenCalled();
  } finally { rendered.unmount(); }
});

test('pending audio recovery refreshes uploaded picker media while preserving its original region', async () => {
  signedInDraft();
  const remote = reviewDraft({ contentJson: [{ type: 'noteLayout', props: { blocks: [{ id: 'image-region', kind: 'image' }, { id: 'audio-region', kind: 'audio' }], mediaBlocks: [{ id: 'image-region', target: 'media', objectKeys: ['notes/owner-a/photo'] }] } }], sections: { media: { items: [{ type: 'IMAGE', objectKey: 'notes/owner-a/photo', url: 'https://private.test/photo?fresh', sortOrder: 0 }] } } });
  const local = draftRecordFromServer({ ...remote, title: 'Local pending audio', updatedAt: '2026-10-05' }, 'review-draft');
  local.mediaItems = local.mediaItems.map((item) => ({ ...item, url: undefined, previewUri: 'blob:revoked-picker' }));
  local.audioItems = [{ type: 'AUDIO', objectKey: '', clientId: 'recording:pending', localRecordingId: 'recording-pending.m4a', uploadStatus: 'PENDING', sortOrder: 0 }];
  jest.mocked(storage.getString).mockImplementation((key) => key.startsWith('circle-im-note-draft:v1:') ? JSON.stringify(local) : undefined); mockFetchDraft.mockResolvedValue(remote);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('Local pending audio'));
    expect(mockRestoreRecording).toHaveBeenCalledWith('owner-a', 'recording-pending.m4a');
    expect(screen.getByTestId('note-media-preview-image').props.source).toEqual({ uri: 'https://private.test/photo?fresh' });
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeEnabled();
  } finally { rendered.unmount(); }
});

test('a resumed uncertain submit stays frozen on a later HTTP 400/429 instead of discarding its original outcome', async () => {
  signedInDraft(); const values = durableDraftStorage(); const local = draftRecordFromServer(reviewDraft(), 'review-draft');
  local.pendingSubmission = { noteId: null, input: { title: 'remote', contentJson: [], media: [], clientDraftID: 'review-draft' } };
  values.set('circle-im-note-draft:v1:owner-a:review-draft', JSON.stringify(local));
  jest.mocked(createNote).mockRejectedValueOnce(new ApiError('Rate limit', { status: 429, failureKind: 'http' })).mockRejectedValueOnce(new ApiError('Invalid input', { status: 400, failureKind: 'http' }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const rendered = render(<EditNoteScreen />);
  try {
    await screen.findByText('notes.edit.pendingSubmitMessage');
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
      await waitFor(() => expect(alert).toHaveBeenCalledTimes(attempt + 1));
      expect(storedReviewDraft(values)?.pendingSubmission).toBeTruthy(); expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.editable).toBe(false);
    }
    expect(mockDeleteDraft).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test('text autosaves coalesce delayed remote requests and Save/Exit flushes the latest text', async () => {
  jest.useFakeTimers(); signedInDraft();
  mockFetchDraft.mockResolvedValue(reviewDraft({ contentJson: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial', styles: {} }] }] }));
  const values = durableDraftStorage(); const firstSave = createDeferred<unknown>(); mockSaveDraft.mockReturnValueOnce(firstSave.promise);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(mockEditorProps).toBeTruthy());
    for (let index = 0; index < 6; index++) {
      await act(async () => { mockEditorProps!.onContentChange([{ type: 'paragraph', content: [{ type: 'text', text: 'Burst ' + index, styles: {} }] }]); jest.advanceTimersByTime(200); await Promise.resolve(); });
    }
    expect(mockSaveDraft).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(650); await Promise.resolve(); });
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 30; index++) {
      await act(async () => { mockEditorProps!.onContentChange([{ type: 'paragraph', content: [{ type: 'text', text: 'Latest ' + index, styles: {} }] }]); jest.advanceTimersByTime(200); await Promise.resolve(); });
    }
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    act(() => mockEditorProps!.onContentChange([{ type: 'paragraph', content: [{ type: 'text', text: 'Final before exit', styles: {} }] }]));
    const guard = jest.mocked(usePreventRemove).mock.calls.at(-1)?.[1]; act(() => guard?.({ data: { action: { type: 'GO_BACK' } } } as never));
    act(() => alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'notes.drafts.save')?.onPress?.());
    expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.editable).toBe(false);
    await act(async () => { firstSave.resolve({}); await firstSave.promise; });
    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledTimes(2));
    expect(mockSaveDraft.mock.calls[1][1].content).toBe('Final before exit');
    expect(JSON.stringify(storedReviewDraft(values))).toContain('Final before exit');
    await waitFor(() => expect(jest.mocked(usePreventRemove).mock.calls.at(-1)?.[0]).toBe(false));
  } finally { firstSave.resolve({}); rendered.unmount(); alert.mockRestore(); jest.useRealTimers(); }
});

test.each(['account', 'epoch', 'route'].flatMap((change) => ['success', 'error'].map((outcome) => [change, outcome] as const)))('group create %s %s continuation is fenced', async (change, outcome) => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft()); const pending = createDeferred<unknown>(); mockCreateNoteGroup.mockReturnValueOnce(pending.promise);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.groupsLabel' })); fireEvent.press(screen.getByText('notes.manageGroups.createNew'));
    fireEvent.changeText(screen.getByPlaceholderText('notes.manageGroups.namePlaceholder'), 'Private A group'); fireEvent.press(screen.getByRole('button', { name: 'common.confirm' }));
    await waitFor(() => expect(mockCreateNoteGroup).toHaveBeenCalledWith('Private A group'));
    if (change === 'account') mockDraftAuth.user = { id: 'owner-b', nickname: 'B' };
    if (change !== 'route') mockDraftAuth.sessionEpoch += 1;
    else mockRouteDraftId = 'other-draft';
    rendered.rerender(<EditNoteScreen />); await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.groupsLabel' })); fireEvent.press(screen.getByText('notes.manageGroups.createNew')); fireEvent.changeText(screen.getByPlaceholderText('notes.manageGroups.namePlaceholder'), 'New session group');
    const nextPending = createDeferred<unknown>(); mockCreateNoteGroup.mockReturnValueOnce(nextPending.promise); fireEvent.press(screen.getByRole('button', { name: 'common.confirm' }));
    await act(async () => { if (outcome === 'error') pending.reject(new Error('Old session failure')); else pending.resolve({ id: 'private-a-id', name: 'Private A group', sortOrder: 0, noteCount: 0 }); await pending.promise.catch(() => undefined); });
    expect(screen.queryByText('Private A group')).toBeNull(); expect(screen.getByRole('button', { name: 'notes.groupPicker.saving' })).toBeDisabled(); expect(alert).not.toHaveBeenCalled();
    await act(async () => { nextPending.resolve({ id: 'new-session-id', name: 'New session group', sortOrder: 0, noteCount: 0 }); await nextPending.promise; });
    fireEvent.press(screen.getByRole('button', { name: 'common.done' })); fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(createNote).toHaveBeenCalled()); expect(jest.mocked(createNote).mock.calls.at(-1)?.[0].groupIds).toEqual(['new-session-id']);
  } finally { pending.resolve({}); rendered.unmount(); alert.mockRestore(); }
});

test('positive audio duration renders a localized seconds unit instead of an HTML entity', async () => {
  signedInDraft(); mockTranslate = (key, options) => key === 'notes.edit.audioDuration' ? String(options?.seconds) + ' 秒' : key;
  mockFetchDraft.mockResolvedValue(reviewDraft({ sections: { audio: { items: [{ type: 'AUDIO', objectKey: 'notes/owner-a/audio', durationMs: 5100, sortOrder: 0 }] } } }));
  const rendered = render(<EditNoteScreen />);
  try { await screen.findByText('5 秒'); expect(screen.queryByText('5&quot;')).toBeNull(); } finally { rendered.unmount(); }
});

test('a successful canonical response accepts refreshed media metadata and canonical card snapshots', async () => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft({ sections: {
    media: { items: [{ type: 'IMAGE', objectKey: 'notes/owner-a/photo', url: 'https://private.test/photo?old-signature', sortOrder: 0 }] },
    contacts: { items: [{ id: 'owner-a', name: 'Old profile name', faceURL: 'https://old-avatar' }] },
  } }));
  jest.mocked(createNote).mockImplementationOnce(async (input) => {
    const canonical = noteResult(input);
    canonical.sections = { ...canonical.sections, media: { items: input.sections!.media!.items.map((item) => ({ ...item, url: 'https://private.test/photo?fresh-signature', width: 100 })) }, contacts: { items: [{ id: 'owner-a', name: 'Current canonical name', faceURL: 'https://new-avatar' }] } };
    return canonical;
  });
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await waitFor(() => expect(mockDeleteDraft).toHaveBeenCalledWith('review-draft'));
    expect(screen.queryByText('notes.edit.pendingSubmitConflict')).toBeNull();
  } finally { rendered.unmount(); }
});

test.each(['layout-order', 'media-ownership', 'media-metadata'] as const)('an otherwise identical %s replay keeps the frozen local submission', async (difference) => {
  signedInDraft();
  const body = [{ type: 'paragraph', content: [{ type: 'text', text: 'Same visible body' }] }];
  const layout = { type: 'noteLayout', props: {
    order: ['title', 'text', 'image', 'image'],
    blocks: [{ id: 'title-fixed', kind: 'title' }, { id: 'text-a', kind: 'text' }, { id: 'image-a', kind: 'image' }, { id: 'image-b', kind: 'image' }],
    textBlocks: [{ id: 'text-a', content: body }],
    mediaBlocks: [{ id: 'image-a', target: 'media', objectKeys: ['notes/owner-a/a'] }, { id: 'image-b', target: 'media', objectKeys: ['notes/owner-a/b'] }],
  } };
  mockFetchDraft.mockResolvedValue(reviewDraft({ sections: {
    text: { content: 'Same visible body', contentJson: [...body, layout] },
    media: { items: [{ type: 'IMAGE', objectKey: 'notes/owner-a/a', width: 320, sortOrder: 0 }, { type: 'IMAGE', objectKey: 'notes/owner-a/b', sortOrder: 1 }] },
  } }));
  const values = durableDraftStorage();
  jest.mocked(createNote).mockImplementationOnce(async (input) => {
    const replayInput = JSON.parse(JSON.stringify(input)) as CreateNoteInput;
    const metadata = replayInput.sections!.text!.contentJson!.find((block) => block.type === 'noteLayout')!.props as typeof layout.props;
    if (difference === 'layout-order') [metadata.blocks[2], metadata.blocks[3]] = [metadata.blocks[3], metadata.blocks[2]];
    else if (difference === 'media-ownership') [metadata.mediaBlocks[0].objectKeys, metadata.mediaBlocks[1].objectKeys] = [metadata.mediaBlocks[1].objectKeys, metadata.mediaBlocks[0].objectKeys];
    else { replayInput.media[0].width = 500; replayInput.sections!.media!.items[0].width = 500; }
    return noteResult(replayInput);
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' }));
    await screen.findByText('notes.edit.pendingSubmitConflict');
    expect(storedReviewDraft(values)?.pendingSubmission?.input.sections?.media?.items[0].width).toBe(320);
    expect(mockDeleteDraft).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test('late consumed draft cleanup cannot navigate away from the next account editor', async () => {
  signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft()); const deletion = createDeferred<void>(); mockDeleteDraft.mockReturnValueOnce(deletion.promise);
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('remote'));
    fireEvent.press(screen.getByRole('button', { name: 'notes.edit.done' })); await waitFor(() => expect(mockDeleteDraft).toHaveBeenCalled());
    mockDraftAuth.user = { id: 'owner-b', nickname: 'B' }; mockDraftAuth.sessionEpoch += 1; mockRouteDraftId = undefined; rendered.rerender(<EditNoteScreen />);
    await waitFor(() => expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe(''));
    fireEvent.changeText(screen.getByPlaceholderText('notes.edit.titlePlaceholder'), 'Current B content');
    await act(async () => { deletion.resolve(); await deletion.promise; });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(mockRouter.back).not.toHaveBeenCalled(); expect(screen.getByPlaceholderText('notes.edit.titlePlaceholder').props.value).toBe('Current B content');
  } finally { deletion.resolve(); rendered.unmount(); }
});

test('Back flushes a locally autosaved latest snapshot before cancelling its remote debounce', async () => {
  jest.useFakeTimers(); signedInDraft(); mockFetchDraft.mockResolvedValue(reviewDraft({ contentJson: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial', styles: {} }] }] }));
  const rendered = render(<EditNoteScreen />);
  try {
    await waitFor(() => expect(mockEditorProps).toBeTruthy());
    await act(async () => { mockEditorProps!.onContentChange([{ type: 'paragraph', content: [{ type: 'text', text: 'Latest before Back', styles: {} }] }]); jest.advanceTimersByTime(180); await Promise.resolve(); });
    expect(mockSaveDraft).not.toHaveBeenCalled();
    const guard = jest.mocked(usePreventRemove).mock.calls.at(-1)?.[1]; act(() => guard?.({ data: { action: { type: 'GO_BACK' } } } as never));
    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledTimes(1));
    expect(mockSaveDraft.mock.calls[0][1].content).toBe('Latest before Back');
    await waitFor(() => expect(jest.mocked(usePreventRemove).mock.calls.at(-1)?.[0]).toBe(false));
  } finally { rendered.unmount(); jest.useRealTimers(); }
});
