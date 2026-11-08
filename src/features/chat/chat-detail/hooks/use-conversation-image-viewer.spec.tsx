import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, View as MockView } from 'react-native';
import type { ChatMessage } from '@/types';
import { useConversationImageViewer } from './use-conversation-image-viewer';

jest.mock('@/components/ui/image-viewer', () => ({
  ImageViewer: (props: object) => <MockView testID="gallery" {...props} />,
}));

const photo = (id: string, extra = {}): ChatMessage => ({
  id, type: 'image', imageUrl: `https://example.test/${id}.jpg`, imageKey: `${id}.jpg`, ...extra,
});
const clip = (id: string, extra = {}): ChatMessage => ({
  id, type: 'video', videoUrl: `https://example.test/${id}.mp4`, videoThumbUrl: `https://example.test/${id}.jpg`, videoThumbKey: `${id}-poster.jpg`, ...extra,
});
function Gallery({ messages, target = photo('middle'), burnEnabled = false }: { messages: ChatMessage[]; target?: ChatMessage; burnEnabled?: boolean }) {
  const { imageViewer, openMedia } = useConversationImageViewer(messages, burnEnabled, 'policy', jest.fn());
  return <><Pressable testID="open" onPress={() => openMedia(target)} />{imageViewer}</>;
}

test('opens the tapped photo in chronological conversation order, excluding non-images and unavailable media', () => {
  render(<Gallery messages={[
    photo('new', { burnDurationSec: 30 }),
    { id: 'text', type: 'received' },
    photo('missing', { imageUrl: undefined }),
    photo('middle'), photo('old', { imageUrl: 'file:///old.jpg' }),
  ]} />);
  fireEvent.press(screen.getByTestId('open'));
  const gallery = screen.getByTestId('gallery');
  expect(gallery.props.images).toEqual(['file:///old.jpg', 'https://example.test/middle.jpg', 'https://example.test/new.jpg']);
  expect(gallery.props.cacheKeys).toEqual([undefined, 'middle.jpg', 'new.jpg']);
  expect(gallery.props.initialIndex).toBe(1);
  expect(gallery.props.privacyModes).toEqual(['standard', 'standard', 'ephemeral']);
});

test('keeps the currently swiped image selected as history arrives and URLs refresh; closes when it disappears', () => {
  const view = render(<Gallery messages={[photo('new'), photo('middle'), photo('old')]} />);
  fireEvent.press(screen.getByTestId('open'));
  act(() => screen.getByTestId('gallery').props.onIndexChange(2));
  view.rerender(<Gallery messages={[photo('new', { imageUrl: 'https://example.test/new.jpg?fresh' }), photo('middle'), photo('old'), photo('older')]} />);
  expect(screen.getByTestId('gallery').props.initialIndex).toBe(3);
  expect(screen.getByTestId('gallery').props.images[3]).toContain('?fresh');
  view.rerender(<Gallery messages={[photo('middle'), photo('old')]} />);
  expect(screen.queryByTestId('gallery')).toBeNull();
});

test('photos and videos page together in conversation order; video pages carry their poster and source', () => {
  render(<Gallery target={clip('video')} messages={[photo('new'), clip('video'), photo('old')]} />);
  fireEvent.press(screen.getByTestId('open'));
  const gallery = screen.getByTestId('gallery');
  expect(gallery.props.images).toEqual(['https://example.test/old.jpg', 'https://example.test/video.jpg', 'https://example.test/new.jpg']);
  expect(gallery.props.cacheKeys).toEqual(['old.jpg', 'video-poster.jpg', 'new.jpg']);
  expect(gallery.props.videos).toEqual([undefined, 'https://example.test/video.mp4', undefined]);
  expect(gallery.props.initialIndex).toBe(1);
});

test('only a video opened from its bubble auto-plays', () => {
  const messages = [clip('video'), photo('middle')];
  const opened = render(<Gallery target={clip('video')} messages={messages} />);
  fireEvent.press(screen.getByTestId('open'));
  expect(screen.getByTestId('gallery').props.autoPlayInitialVideo).toBe(true);
  opened.unmount();
  render(<Gallery messages={messages} />);
  fireEvent.press(screen.getByTestId('open'));
  expect(screen.getByTestId('gallery').props.autoPlayInitialVideo).toBe(false);
});

test('videos with no playable source stay out of the gallery', () => {
  render(<Gallery messages={[clip('broken', { videoUrl: undefined }), photo('middle')]} />);
  fireEvent.press(screen.getByTestId('open'));
  expect(screen.getByTestId('gallery').props.videos).toEqual([undefined]);
});

test('a video with a local poster gets no cache key and one without a poster gets an empty page image', () => {
  render(<Gallery target={clip('local')} messages={[clip('local', { videoThumbUrl: 'file:///poster.jpg' }), clip('bare', { videoThumbUrl: undefined, videoThumbKey: undefined })]} />);
  fireEvent.press(screen.getByTestId('open'));
  const gallery = screen.getByTestId('gallery');
  expect(gallery.props.images).toEqual(['', 'file:///poster.jpg']);
  expect(gallery.props.cacheKeys).toEqual([undefined, undefined]);
});

test('a burn video is marked ephemeral so its bytes stay off the disk', () => {
  render(<Gallery target={clip('video')} messages={[clip('video', { burnDurationSec: 30 })]} />);
  fireEvent.press(screen.getByTestId('open'));
  expect(screen.getByTestId('gallery').props.privacyModes).toEqual(['ephemeral']);
});

test('turning burn on closes the viewer so its player is released before the cache sweep', () => {
  const messages = [clip('video')];
  const view = render(<Gallery target={clip('video')} messages={messages} />);
  fireEvent.press(screen.getByTestId('open'));
  expect(screen.getByTestId('gallery')).toBeTruthy();
  view.rerender(<Gallery target={clip('video')} messages={messages} burnEnabled />);
  expect(screen.queryByTestId('gallery')).toBeNull();
});
