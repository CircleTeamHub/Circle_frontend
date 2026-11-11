import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Spacing } from '@/theme';
import { ImageGrid } from './image-grid';
import { MomentMedia } from './moment-media';
import { NoteCard } from '@/features/notes/components/NoteCard';
import { ImageViewer } from '@/components/ui/image-viewer';
import type { NoteSummary } from '@/features/notes/types';

jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: (props: Record<string, unknown>) => <View testID="cached-image" {...props} /> };
});
jest.mock('@/components/ui/image-viewer', () => ({ ImageViewer: jest.fn(() => null) }));
jest.mock('@/components/app/desktop-centered-column', () => ({ useContentColumnWidth: () => 400 }));
jest.mock('@/components/app/UploadProgressHost', () => ({ UploadProgressHost: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/utils/client-diagnostics', () => ({ logClientDiagnostic: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo', () => ({ useEventListener: jest.fn() }));
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: () => null }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: jest.requireActual('@/theme/colors').darkColors }),
}));

test('feed thumbnails persist on disk without downloading the larger preview as a placeholder', () => {
  render(<ImageGrid images={['https://cdn.test/original?sig=a']} media={[{
    key: 'photo', thumbUrl: 'https://cdn.test/thumb?sig=a', thumbKey: 'photo-thumb',
    previewUrl: 'https://cdn.test/preview?sig=a', originalKey: 'photo-original',
  }]} />);
  const image = screen.getByTestId('cached-image');
  expect(image.props.cachePolicy).toBe('memory-disk');
  expect(image.props.source).toEqual({ uri: 'https://cdn.test/thumb?sig=a', cacheKey: 'photo-thumb' });
  expect(image.props.placeholder).toBeUndefined();
});

test('plaza cards show a single image as one nine-grid cell instead of a large preview', () => {
  const cellWidth = Math.floor((400 - Spacing.lg * 2 - Spacing.md * 2 - Spacing.xs * 2) / 3);
  const cellStyle = () => StyleSheet.flatten(screen.getByRole('imagebutton').props.style);
  const { rerender } = render(<ImageGrid images={['photo']} />);
  expect(cellStyle().width).toBeGreaterThan(cellWidth);
  rerender(<ImageGrid images={['photo']} uniformCells />);
  expect(cellStyle()).toMatchObject({ width: cellWidth, height: cellWidth });
});

test('feed preview fallback keeps a distinct stable key when the signed URL refreshes', () => {
  const { rerender } = render(<ImageGrid images={['original']} media={[{ key: 'photo', previewUrl: 'preview?sig=a', previewKey: 'photo-preview' }]} />);
  expect(screen.getByTestId('cached-image').props.source.cacheKey).toBe('photo-preview');
  rerender(<ImageGrid images={['original']} media={[{ key: 'photo', previewUrl: 'preview?sig=b', previewKey: 'photo-preview' }]} />);
  expect(screen.getByTestId('cached-image').props.source).toEqual({ uri: 'preview?sig=b', cacheKey: 'photo-preview' });
});

test('feed thumbnails derive a variant key from the object key when no thumb key is returned', () => {
  render(<ImageGrid images={['original']} media={[{ key: 'photo', thumbUrl: 'thumb?sig=a' }]} />);
  expect(screen.getByTestId('cached-image').props.source.cacheKey).toBe('photo:thumb');
});

test('mixed-feed images and posters use stable variant keys and pass original keys to the viewer', () => {
  const attachments = [
    { type: 'video' as const, key: 'video', posterKey: 'video-poster', url: 'video?sig=a', posterUrl: 'poster?sig=a' },
    { type: 'image' as const, key: 'photo', url: 'original?sig=a' },
  ];
  const { rerender } = render(<MomentMedia images={[]} attachments={attachments} media={[{ key: 'photo', thumbUrl: 'thumb?sig=a', thumbKey: 'photo-thumb', originalKey: 'photo-original' }]} />);
  const images = screen.getAllByTestId('cached-image');
  expect(images.map((image) => image.props.cachePolicy)).toEqual(['memory-disk', 'memory-disk']);
  expect(images.map((image) => image.props.source.cacheKey)).toEqual(['video-poster', 'photo-thumb']);
  fireEvent.press(screen.getByLabelText('moment.openImage'));
  expect(jest.mocked(ImageViewer).mock.lastCall?.[0].cacheKeys).toEqual(['video-poster', 'photo-original']);
  rerender(<MomentMedia images={[]} attachments={attachments.map((item) => ({ ...item, url: item.url.replace('sig=a', 'sig=b'), posterUrl: item.posterUrl?.replace('sig=a', 'sig=b') }))} media={[{ key: 'photo', thumbUrl: 'thumb?sig=b', thumbKey: 'photo-thumb', originalKey: 'photo-original' }]} />);
  expect(screen.getAllByTestId('cached-image').map((image) => image.props.source.cacheKey)).toEqual(['video-poster', 'photo-thumb']);
});

test('mixed-feed legacy image and poster keys cannot collide with the video or original variant', () => {
  render(<MomentMedia images={[]} attachments={[
    { type: 'video', key: 'video', url: 'video', posterUrl: 'poster' },
    { type: 'image', key: 'photo', url: 'original' },
  ]} />);
  expect(screen.getAllByTestId('cached-image').map((image) => image.props.source.cacheKey)).toEqual(['video:poster', 'photo']);
  fireEvent.press(screen.getByLabelText('moment.openImage'));
  expect(jest.mocked(ImageViewer).mock.lastCall?.[0].cacheKeys).toEqual(['video:poster', 'photo']);
});

test('note covers cache by note and media ID across signature refresh and change key for a replacement cover', () => {
  const note: NoteSummary = { id: 'note', title: 'Note', contentPreview: null, status: 'ACTIVE', available: true, pinned: false,
    groups: [], cover: { id: 'media', type: 'IMAGE', url: 'cover?sig=a' }, imageCount: 1, videoCount: 0, mediaCount: 1,
    createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' };
  const { rerender } = render(<NoteCard note={note} onPress={jest.fn()} />);
  const cover = screen.getByTestId('cached-image');
  expect(cover.props.cachePolicy).toBe('memory-disk');
  expect(cover.props.source.cacheKey).toBe('note:note:cover:media');
  rerender(<NoteCard note={{ ...note, cover: { ...note.cover!, url: 'cover?sig=b' } }} onPress={jest.fn()} />);
  expect(screen.getByTestId('cached-image').props.source).toEqual({ uri: 'cover?sig=b', cacheKey: 'note:note:cover:media' });
  rerender(<NoteCard note={{ ...note, cover: { ...note.cover!, id: 'replacement' } }} onPress={jest.fn()} />);
  expect(screen.getByTestId('cached-image').props.source.cacheKey).toBe('note:note:cover:replacement');
});
