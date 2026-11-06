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
    const hosts: { props: { style?: StyleProp<ViewStyle> } }[] = screen.UNSAFE_root.findAll(
      (item: { type: unknown; props: { accessible?: boolean } }) => typeof item.type === 'string' && item.props.accessible === true,
    );
    const widths = hosts.flatMap(item => {
      const style = StyleSheet.flatten(item.props.style);
      return typeof style?.width === 'number' && style.width === style.height ? [style.width] : [];
    });
    expect(widths).toHaveLength(count);
    // 390px screen - 48px page padding - 40px avatar - 10px avatar gap.
    const bodyWidth = 292;
    for (const width of widths) {
      expect(width * 3 + 4 * 2).toBeLessThanOrEqual(bodyWidth);
      expect(width * 4 + 4 * 3).toBeGreaterThan(bodyWidth);
    }
  },
);
