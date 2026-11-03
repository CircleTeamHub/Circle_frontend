import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { MomentMedia } from './moment-media';
import { ImageViewer } from '@/components/ui/image-viewer';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/desktop-centered-column', () => ({ useContentColumnWidth: () => 400 }));
jest.mock('expo-image', () => ({ Image: ({ source }: { source: { uri: string } }) => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return <Text>{source.uri}</Text>;
} }));
jest.mock('@/theme', () => ({ Spacing: { xs: 4, lg: 16, md: 12 }, Radius: { sm: 4 } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/image-viewer', () => ({ ImageViewer: jest.fn(() => null) }));
jest.mock('./image-grid', () => ({ ImageGrid: () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return <Text>legacy images</Text>;
} }));
const mockPlay = jest.fn();
const mockPause = jest.fn();
let mockStatusListener: ((event: { status: string }) => void) | undefined;
jest.mock('expo', () => ({ useEventListener: (_player: unknown, _event: string, listener: typeof mockStatusListener) => { mockStatusListener = listener; } }));
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(() => ({ play: mockPlay, pause: mockPause })),
  VideoView: () => null,
}));

test('renders mixed tiles in order and only creates a player after the selected video is opened', () => {
  const { useVideoPlayer } = jest.requireMock('expo-video');
  jest.clearAllMocks();
  render(<MomentMedia images={[]} attachments={[
    { type: 'video', key: 'clip', url: 'https://cdn.test/clip.mp4', posterUrl: 'https://cdn.test/poster.jpg' },
    { type: 'image', key: 'photo', url: 'https://cdn.test/photo.jpg' },
    { type: 'video', key: 'clip2', url: 'https://cdn.test/clip2.mp4' },
  ]} />);
  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual(['moment.playVideo', 'moment.openImage', 'moment.playVideo']);
  expect(useVideoPlayer).not.toHaveBeenCalled();
  fireEvent.press(screen.getAllByLabelText('moment.playVideo')[1]);
  expect(useVideoPlayer).toHaveBeenCalledWith('https://cdn.test/clip2.mp4', expect.any(Function));
  fireEvent.press(screen.getByLabelText('common.close'));
  expect(mockPause).toHaveBeenCalled();
});

test('continues to render legacy image posts', () => {
  render(<MomentMedia images={['https://cdn.test/old.jpg']} />);
  expect(screen.getByText('legacy images')).toBeTruthy();
});

test('keeps the selected image index when a feed refresh replaces attachment objects', () => {
  const attachments = [
    { type: 'video' as const, key: 'clip', url: 'https://cdn.test/clip.mp4' },
    { type: 'image' as const, key: 'first', url: 'https://cdn.test/first.jpg' },
    { type: 'image' as const, key: 'second', url: 'https://cdn.test/second.jpg' },
  ];
  const { rerender } = render(<MomentMedia images={[]} attachments={attachments} />);
  fireEvent.press(screen.getAllByLabelText('moment.openImage')[1]);
  expect(jest.mocked(ImageViewer).mock.lastCall?.[0].initialIndex).toBe(1);

  rerender(<MomentMedia images={[]} attachments={attachments.map((item) => ({ ...item }))} />);
  expect(jest.mocked(ImageViewer).mock.lastCall?.[0].initialIndex).toBe(1);
});

test('shows an actionable error when a selected video cannot load', () => {
  mockStatusListener = undefined;
  render(<MomentMedia images={[]} attachments={[{ type: 'video', key: 'clip', url: 'https://cdn.test/clip.mp4' }]} />);
  fireEvent.press(screen.getByLabelText('moment.playVideo'));
  expect(mockStatusListener).toEqual(expect.any(Function));
  act(() => mockStatusListener?.({ status: 'error' }));
  expect(screen.getByText('moment.videoUnavailable')).toBeTruthy();
  expect(screen.getByLabelText('common.close')).toBeTruthy();
});
