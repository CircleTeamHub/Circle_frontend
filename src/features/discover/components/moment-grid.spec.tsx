import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MomentCard } from './moment-card';
import type { MomentPost } from '@/types';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh' } }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: jest.fn() }) }));
jest.mock('@/components/app/desktop-centered-column', () => ({ useContentColumnWidth: () => 390 }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/member-name', () => ({ MemberName: () => null }));
jest.mock('@/components/ui/image-viewer', () => ({ ImageViewer: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo', () => ({ useEventListener: jest.fn() }));
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24 }, Radius: { sm: 8 },
  Typography: { body: {}, bodyRegular: {}, caption: {}, small: {} },
  useTheme: () => ({ colors: {} }),
}));

test.each([2, 3, 4, 9].flatMap(count => ['images', 'mixed'].map(kind => ({ count, kind }))))(
  '$count $kind fit three columns beside the author avatar', ({ count, kind }) => {
    const attachments = Array.from({ length: count }, (_, index) => ({
      type: kind === 'mixed' && index % 2 === 0 ? 'video' as const : 'image' as const,
      key: `media-${index}`, url: `https://cdn.test/media-${index}`,
    }));
    const post = {
      id: 'post', content: 'media', createdAt: new Date().toISOString(),
      author: { id: 'author', nickname: 'Author' }, commentCount: 0, likeCount: 0,
      images: attachments.filter(item => item.type === 'image').map(item => item.url),
      ...(kind === 'mixed' ? { attachments } : {}),
    } as MomentPost;
    render(<MomentCard post={post} scope="discover" onLike={jest.fn()} onPress={jest.fn()} />);
    const tiles = screen.UNSAFE_root
      .findAll((item: Host) => typeof item.type === 'string' && item.props.accessible === true)
      .filter((item: Host) => hostAncestor(item, (style) => style.aspectRatio === 1));
    expect(tiles).toHaveLength(count);
    // Cells share their row's real width instead of a pixel size guessed from the screen.
    const cells = tiles.map((tile: Host) => hostAncestor(tile, (style) => style.aspectRatio === 1)!);
    for (const cell of cells) expect(StyleSheet.flatten(cell.props.style)).toMatchObject({ flex: 1 });
    const rows: (Host | null)[] = cells.map((cell: Host) => hostAncestor(cell, (style) => style.flexDirection === 'row'));
    expect(new Set(rows).size).toBe(Math.ceil(count / 3));
    for (const row of new Set(rows)) expect(rows.filter((item) => item === row).length).toBeLessThanOrEqual(3);
  },
);

type Host = { type: unknown; parent: Host | null; props: { accessible?: boolean; style?: StyleProp<ViewStyle> } };

function hostAncestor(node: Host, match: (style: ViewStyle) => boolean): Host | null {
  for (let parent = node.parent; parent; parent = parent.parent) {
    const style = StyleSheet.flatten(parent.props.style);
    if (typeof parent.type === 'string' && style && match(style)) return parent;
  }
  return null;
}
