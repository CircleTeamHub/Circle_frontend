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
jest.mock('./image-grid', () => ({ ...jest.requireActual('./image-grid'), ImageGrid: () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return <Text>legacy images</Text>;
} }));
const mixed = [
  { type: 'video' as const, key: 'clip', url: 'https://cdn.test/clip.mp4', posterUrl: 'https://cdn.test/poster.jpg' },
  { type: 'image' as const, key: 'photo', url: 'https://cdn.test/photo.jpg' },
  { type: 'video' as const, key: 'clip2', url: 'https://cdn.test/clip2.mp4' },
];
const viewerProps = () => jest.mocked(ImageViewer).mock.lastCall?.[0];

test('renders mixed tiles in order and opens no viewer until one is tapped', () => {
  jest.mocked(ImageViewer).mockClear();
  render(<MomentMedia images={[]} attachments={mixed} />);
  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual(['moment.playVideo', 'moment.openImage', 'moment.playVideo']);
  expect(ImageViewer).not.toHaveBeenCalled();
});

test('a tapped video opens in one gallery with the photos and auto-plays', () => {
  render(<MomentMedia images={[]} attachments={mixed} />);
  fireEvent.press(screen.getAllByLabelText('moment.playVideo')[1]);
  expect(viewerProps()?.images).toEqual(['https://cdn.test/poster.jpg', 'https://cdn.test/photo.jpg', '']);
  expect(viewerProps()?.videos).toEqual(['https://cdn.test/clip.mp4', undefined, 'https://cdn.test/clip2.mp4']);
  expect(viewerProps()?.initialIndex).toBe(2);
  expect(viewerProps()?.autoPlayInitialVideo).toBe(true);
});

test('a tapped photo opens the same gallery without auto-playing a video', () => {
  render(<MomentMedia images={[]} attachments={mixed} />);
  fireEvent.press(screen.getByLabelText('moment.openImage'));
  expect(viewerProps()?.initialIndex).toBe(1);
  expect(viewerProps()?.autoPlayInitialVideo).toBe(false);
});

test('closing the gallery returns to the feed', () => {
  render(<MomentMedia images={[]} attachments={mixed} />);
  fireEvent.press(screen.getByLabelText('moment.openImage'));
  const close = viewerProps()!.onClose;
  jest.mocked(ImageViewer).mockClear();
  act(() => close());
  expect(ImageViewer).not.toHaveBeenCalled();
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
  expect(jest.mocked(ImageViewer).mock.lastCall?.[0].initialIndex).toBe(2);

  rerender(<MomentMedia images={[]} attachments={attachments.map((item) => ({ ...item }))} />);
  expect(jest.mocked(ImageViewer).mock.lastCall?.[0].initialIndex).toBe(2);
});
