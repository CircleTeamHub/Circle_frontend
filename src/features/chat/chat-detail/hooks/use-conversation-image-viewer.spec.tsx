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
function Gallery({ messages }: { messages: ChatMessage[] }) {
  const { imageViewer, openImage } = useConversationImageViewer(messages, false, 'policy', jest.fn());
  return <><Pressable testID="open" onPress={() => openImage(photo('middle'))} />{imageViewer}</>;
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
