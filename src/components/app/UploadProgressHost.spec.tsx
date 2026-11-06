import { act, render, screen } from '@testing-library/react-native';
import { ActivityIndicator, Modal, StyleSheet } from 'react-native';
import { UploadProgressHost } from './UploadProgressHost';
import { useUploadProgressStore } from '@/stores/upload-progress-store';

jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      const labels: Record<string, string> = {
        'mediaUpload.uploading': 'Uploading',
        'mediaUpload.image': 'Image',
        'mediaUpload.video': 'Video',
        'mediaUpload.preparing': 'Preparing…',
        'mediaUpload.confirming': 'Confirming…',
        'mediaUpload.additional': `+${options?.count} more`,
      };
      return labels[key] ?? key;
    },
  }),
}));

beforeEach(() => useUploadProgressStore.setState({ tasks: {} }));
afterEach(() => useUploadProgressStore.setState({ tasks: {} }));

test('stays absent without tasks and never creates another native modal', () => {
  render(<UploadProgressHost />);
  expect(screen.queryByTestId('upload-progress-host')).toBeNull();
  expect(screen.UNSAFE_queryByType(Modal)).toBeNull();
});

test('shows real byte percentage in a safe-area card without intercepting touches', () => {
  useUploadProgressStore.setState({ tasks: {
    image: { id: 'image', kind: 'image', loaded: 350, total: 1000 },
  } });
  render(<UploadProgressHost />);

  expect(screen.getByText('35%')).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: 'Image' }).props.accessibilityValue).toEqual({
    min: 0, max: 100, now: 35, text: '35%',
  });
  const host = screen.getByTestId('upload-progress-host');
  expect(host.props.pointerEvents).toBe('none');
  expect(StyleSheet.flatten(host.props.style).top).toBeGreaterThanOrEqual(44);
  expect(screen.UNSAFE_queryByType(Modal)).toBeNull();
});

test('keeps unknown totals indeterminate instead of inventing a percentage', () => {
  useUploadProgressStore.setState({ tasks: {
    video: { id: 'video', kind: 'video', loaded: 0, total: null },
  } });
  render(<UploadProgressHost />);
  expect(screen.getByRole('progressbar', { name: 'Video' }).props.accessibilityValue).toEqual({ text: 'Preparing…' });
  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  expect(screen.queryByText(/\d+%/)).toBeNull();

  act(() => useUploadProgressStore.setState({ tasks: {
    video: { id: 'video', kind: 'video', loaded: 200, total: null },
  } }));
  expect(screen.getByRole('progressbar', { name: 'Video' }).props.accessibilityValue).toEqual({ text: 'Uploading' });
});

test('labels transferred bytes as confirming until the request actually completes', () => {
  useUploadProgressStore.setState({ tasks: {
    image: { id: 'image', kind: 'image', loaded: 1000, total: 1000 },
  } });
  render(<UploadProgressHost />);
  expect(screen.getByText('Confirming…')).toBeTruthy();
  expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({
    min: 0, max: 100, now: 100, text: 'Confirming…',
  });

  act(() => useUploadProgressStore.setState({ tasks: {} }));
  expect(screen.queryByTestId('upload-progress-host')).toBeNull();
});

test('keeps chat transfers in their media bubbles and bounds other upload rows', () => {
  useUploadProgressStore.setState({ tasks: {
    image: { id: 'image', kind: 'image', loaded: 100, total: 1000 },
    video: { id: 'video', kind: 'video', progressKey: 'message-id', loaded: 700, total: 1000 },
    third: { id: 'third', kind: 'image', loaded: 0, total: null },
    fourth: { id: 'fourth', kind: 'video', loaded: 0, total: null },
  } });
  render(<UploadProgressHost />);
  expect(screen.getByText('10%')).toBeTruthy();
  expect(screen.queryByText('70%')).toBeNull();
  expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  expect(screen.getByText('+1 more')).toBeTruthy();
});

test('does not duplicate a chat video transfer in the upper-right card', () => {
  useUploadProgressStore.setState({ tasks: {
    video: { id: 'video', kind: 'video', progressKey: 'message-id', loaded: 700, total: 1000 },
  } });
  render(<UploadProgressHost />);
  expect(screen.queryByTestId('upload-progress-host')).toBeNull();
  expect(useUploadProgressStore.getState().tasks.video.loaded).toBe(700);
});

test('mounting and unmounting another modal host does not clear shared tasks', () => {
  useUploadProgressStore.setState({ tasks: {
    image: { id: 'image', kind: 'image', loaded: 100, total: 1000 },
  } });
  render(<UploadProgressHost />);
  const modalHost = render(<UploadProgressHost />);
  modalHost.unmount();
  expect(useUploadProgressStore.getState().tasks.image.loaded).toBe(100);
});
