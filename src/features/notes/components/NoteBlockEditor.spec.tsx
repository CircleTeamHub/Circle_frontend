import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NoteBlockEditor } from './NoteBlockEditor';

const mockRequestPermission = jest.fn();
const mockLaunchPicker = jest.fn();
const mockRequestPresign = jest.fn();
const mockUploadFile = jest.fn();
const mockReportHandledFailure = jest.fn();

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestPermission(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchPicker(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

jest.mock('@/theme', () => ({
  useTheme: () => ({ resolvedMode: 'light' }),
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

type MockDOMEditorProps = {
  pendingInserts: Record<string, unknown>[];
  onImageRequest: () => void;
  onVideoRequest: () => void;
};
let mockDomProps: MockDOMEditorProps | undefined;

jest.mock('@/features/notes/dom/NoteBlockEditor.dom', () => ({
  __esModule: true,
  default: (props: MockDOMEditorProps) => {
    mockDomProps = props;
    const { Pressable: MockPressable } = jest.requireActual<typeof import('react-native')>('react-native');
    return <>
      <MockPressable testID="request-image" onPress={props.onImageRequest} />
      <MockPressable testID="request-video" onPress={props.onVideoRequest} />
    </>;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockDomProps = undefined;
  mockRequestPermission.mockResolvedValue({ granted: true });
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: Array.from({ length: 12 }, (_, index) => ({
      uri: `file:///picked-${index}.jpg`,
      width: 100,
      height: 80,
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
});

test('caps standalone editor web-overflow uploads in picker order and reports omitted files', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<NoteBlockEditor initialContent={null} onContentChange={jest.fn()} />);

  fireEvent.press(screen.getByTestId('request-image'));

  await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(10));
  expect(mockRequestPresign.mock.calls.map(([request]) => request.filename)).toEqual(
    Array.from({ length: 10 }, (_, index) => `picked-${index}.jpg`),
  );
  expect(alert).toHaveBeenCalledWith(
    'notes.editor.selectionLimitExceededTitle',
    'notes.editor.selectionLimitExceededMessage',
  );
});

test('releases standalone overflow blobs at once and inserted previews at unmount', async () => {
  const previousWindow = global.window;
  const previousURL = global.URL;
  const revokeObjectURL = jest.fn();
  Object.defineProperty(global, 'window', { configurable: true, value: {} });
  Object.defineProperty(global, 'URL', { configurable: true, value: { revokeObjectURL } });
  let resolveUpload!: () => void;
  const upload = new Promise<void>((resolve) => { resolveUpload = resolve; });
  mockUploadFile.mockReturnValue(upload);
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'blob:standalone-active', width: 100, height: 80 },
      ...Array.from({ length: 10 }, (_, index) => ({ uri: `blob:standalone-overflow-${index}` })),
    ],
  });
  try {
    const rendered = render(<NoteBlockEditor initialContent={null} onContentChange={jest.fn()} />);
    fireEvent.press(screen.getByTestId('request-image'));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:standalone-overflow-9');

    resolveUpload();
    await upload;
    await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(10));
    // 私有目录没有可直读的远端地址，插进文档的块用的就是这些本地地址：
    // 上传一落地就 revoke 等于把刚插进去的图变成裂图。
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:standalone-active');

    rendered.unmount();
    await Promise.resolve();
    expect(revokeObjectURL.mock.calls.filter(([uri]) => uri === 'blob:standalone-active')).toHaveLength(1);
  } finally {
    Object.defineProperty(global, 'window', { configurable: true, value: previousWindow });
    Object.defineProperty(global, 'URL', { configurable: true, value: previousURL });
  }
});

test('releases a standalone blob picker URL after a failed upload', async () => {
  const previousWindow = global.window;
  const previousURL = global.URL;
  const revokeObjectURL = jest.fn();
  Object.defineProperty(global, 'window', { configurable: true, value: {} });
  Object.defineProperty(global, 'URL', { configurable: true, value: { revokeObjectURL } });
  mockLaunchPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'blob:standalone-failed' }] });
  mockUploadFile.mockRejectedValue(new Error('network failed'));
  try {
    const rendered = render(<NoteBlockEditor initialContent={null} onContentChange={jest.fn()} />);
    fireEvent.press(screen.getByTestId('request-image'));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:standalone-failed'));
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    rendered.unmount();
    await Promise.resolve();
    expect(revokeObjectURL.mock.calls.filter(([uri]) => uri === 'blob:standalone-failed')).toHaveLength(1);
  } finally {
    Object.defineProperty(global, 'window', { configurable: true, value: previousWindow });
    Object.defineProperty(global, 'URL', { configurable: true, value: previousURL });
  }
});

test('reports a redacted aggregate when standalone media upload fails', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///failed.jpg', width: 100, height: 80 }],
  });
  mockUploadFile.mockRejectedValue(new Error('https://signed.example/private?token=secret'));

  render(<NoteBlockEditor initialContent={null} onContentChange={jest.fn()} />);
  fireEvent.press(screen.getByTestId('request-image'));

  await waitFor(() => expect(mockUploadFile).toHaveBeenCalledTimes(1));
  expect(mockReportHandledFailure).toHaveBeenCalledWith(
    'noteEditor',
    'uploadBatch',
    expect.objectContaining({ message: 'note media batch upload failed' }),
    { failed: 1, total: 1, reason: 'image' },
  );
});

test('presign 不返回 fileUrl 时，独立编辑器插入本地预览并只上报 objectKey', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockLaunchPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///keyed.jpg', width: 100, height: 80 }],
  });
  // notes/ 是私有目录：后端不再返回可直读的地址。
  mockRequestPresign.mockResolvedValue({
    uploadUrl: 'https://upload.example/keyed.jpg',
    fileUrl: null,
    key: 'notes/keyed.jpg',
    requiredHeaders: {},
  });
  const onMediaUploaded = jest.fn();

  render(
    <NoteBlockEditor
      initialContent={null}
      onContentChange={jest.fn()}
      onMediaUploaded={onMediaUploaded}
    />,
  );
  fireEvent.press(screen.getByTestId('request-image'));

  await waitFor(() => expect(onMediaUploaded).toHaveBeenCalledTimes(1));
  const [media] = onMediaUploaded.mock.calls[0];
  expect(media).toEqual(
    expect.objectContaining({ type: 'IMAGE', objectKey: 'notes/keyed.jpg' }),
  );
  // 没有可直读的地址就不上送 url，交给服务端按 objectKey 派生。
  expect(media).not.toHaveProperty('url');
  // 文档里的那一块仍然要看得见：用本地资源地址当预览。
  await waitFor(() =>
    expect(mockDomProps?.pendingInserts).toEqual([
      expect.objectContaining({
        type: 'image',
        url: 'file:///keyed.jpg',
        objectKey: 'notes/keyed.jpg',
      }),
    ]),
  );
  expect(alert).not.toHaveBeenCalled();
  expect(mockReportHandledFailure).not.toHaveBeenCalled();
});
