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

jest.mock('@/features/notes/dom/NoteBlockEditor.dom', () => ({
  __esModule: true,
  default: ({
    onImageRequest,
    onVideoRequest,
  }: {
    onImageRequest: () => void;
    onVideoRequest: () => void;
  }) => {
    const { Pressable: MockPressable } = jest.requireActual<typeof import('react-native')>('react-native');
    return <>
      <MockPressable testID="request-image" onPress={onImageRequest} />
      <MockPressable testID="request-video" onPress={onVideoRequest} />
    </>;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
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

test('releases standalone blob picker URLs at overflow disposal and upload settlement', async () => {
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
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:standalone-active'));
    expect(revokeObjectURL.mock.calls.filter(([uri]) => uri === 'blob:standalone-active')).toHaveLength(1);
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
