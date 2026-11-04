import React, { Profiler } from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { useUploadProgressStore, type UploadProgressTask } from '@/stores/upload-progress-store';
import { MediaUploadProgress } from './media-upload-progress';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const task = (id: string, loaded: number, total: number | null): UploadProgressTask => ({
  id,
  kind: 'image',
  progressKey: id,
  loaded,
  total,
});

beforeEach(() => useUploadProgressStore.setState({ tasks: {} }));

test.each([0, 50])('shows %i percent from the matching transfer byte count', (loaded) => {
  useUploadProgressStore.setState({ tasks: { transfer: task('delivery', loaded, 100) } });
  render(<MediaUploadProgress deliveryId="delivery" kind="image" />);
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ min: 0, max: 100, now: loaded });
  expect(screen.getByText(`mediaUpload.uploading ${loaded}%`)).toBeTruthy();
  expect(screen.getByRole('progressbar').props.pointerEvents).toBe('none');
});

test('keeps an unknown total indeterminate without an invented percentage', () => {
  useUploadProgressStore.setState({ tasks: { transfer: task('delivery', 50, null) } });
  render(<MediaUploadProgress deliveryId="delivery" kind="video" />);
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ text: 'mediaUpload.uploading' });
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBeUndefined();
  expect(screen.queryByText(/%/)).toBeNull();
});

test('shows confirmation rather than completed upload when all bytes have left the device', () => {
  useUploadProgressStore.setState({ tasks: { transfer: task('delivery', 100, 100) } });
  render(<MediaUploadProgress deliveryId="delivery" kind="video" />);
  expect(screen.getByText('mediaUpload.confirming')).toBeTruthy();
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBeUndefined();
  expect(screen.queryByText(/100%/)).toBeNull();
});

test('stays indeterminate during preparation and after transfer completion while the message awaits acknowledgement', () => {
  const view = render(<MediaUploadProgress deliveryId="delivery" kind="image" />);
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ text: 'mediaUpload.processing' });
  act(() => useUploadProgressStore.setState({ tasks: { transfer: task('delivery', 50, 100) } }));
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 50 });
  act(() => useUploadProgressStore.setState({ tasks: {} }));
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ text: 'mediaUpload.processing' });
  view.unmount();
});

test('isolates two delivery IDs and does not rerender for another message transfer', () => {
  useUploadProgressStore.setState({ tasks: { first: task('one', 50, 100), second: task('two', 10, 100) } });
  const renders = jest.fn();
  render(
    <Profiler id="first-message-progress" onRender={renders}>
      <MediaUploadProgress deliveryId="one" kind="image" />
    </Profiler>,
  );
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 50 });
  const renderCount = renders.mock.calls.length;
  act(() => useUploadProgressStore.setState((state) => ({ tasks: { ...state.tasks, second: task('two', 90, 100) } })));
  expect(renders).toHaveBeenCalledTimes(renderCount);
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 50 });
});
