import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type Block = Record<string, unknown>;
type InlineNode = Record<string, unknown>;

// 满宽媒体按真实宽高比渲染（设计稿：无边框圆角大图）。比例夹在
// [3:4, 16:9] 之间，极端全景/长图用 cover 轻裁，避免版面被撑破。
function resolveMediaAspectRatio(
  props: Record<string, unknown>,
  fallback: number,
) {
  const width = typeof props.width === 'number' ? props.width : 0;
  const height = typeof props.height === 'number' ? props.height : 0;
  if (width > 0 && height > 0) {
    return Math.min(16 / 9, Math.max(3 / 4, width / height));
  }
  return fallback;
}

function VideoBlock({
  url,
  caption,
  captionColor,
  aspectRatio,
  backgroundColor,
  onMediaError,
}: {
  url: string;
  caption: string;
  captionColor: string;
  aspectRatio: number;
  backgroundColor: string;
  onMediaError?: () => void;
}) {
  // useVideoPlayer is called unconditionally — the empty-url guard lives in the
  // caller (BlockView), so this component always receives a valid source.
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') {
      onMediaError?.();
    }
  });
  return (
    <View>
      <View style={[s.mediaFrame, { backgroundColor }]}>
        <VideoView
          style={[s.media, { aspectRatio }]}
          player={player}
          nativeControls
          contentFit="contain"
        />
      </View>
      {caption ? (
        <Text style={[s.caption, { color: captionColor }]}>{caption}</Text>
      ) : null}
    </View>
  );
}

function InlineContent({ nodes, textColor }: { nodes: unknown[]; textColor: string }) {
  return (
    <>
      {(nodes as InlineNode[]).map((node, i) => {
        const text = typeof node.text === 'string' ? node.text : '';
        const styles = (node.styles ?? {}) as Record<string, unknown>;
        return (
          <Text
            key={i}
            style={{
              color: textColor,
              fontWeight: styles.bold ? '700' : '400',
              fontStyle: styles.italic ? 'italic' : 'normal',
              textDecorationLine: styles.underline ? 'underline' : 'none',
            }}
          >
            {text}
          </Text>
        );
      })}
    </>
  );
}

function BlockView({
  block,
  onMediaError,
}: {
  block: Block;
  onMediaError?: () => void;
}) {
  const { colors } = useTheme();
  const d = useMemo(
    () => ({
      text: colors.text,
      secondary: colors.textSecondary,
      primary: colors.primary,
      codeBlock: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
    }),
    [colors],
  );

  const type = block.type as string;
  const content = Array.isArray(block.content) ? (block.content as unknown[]) : [];
  const props = (block.props ?? {}) as Record<string, unknown>;

  switch (type) {
    case 'heading': {
      const level = (props.level as number) ?? 1;
      const style = level === 1 ? s.h1 : level === 2 ? s.h2 : s.h3;
      return (
        <Text style={[style, { color: d.text }]}>
          <InlineContent nodes={content} textColor={d.text} />
        </Text>
      );
    }

    case 'paragraph':
      return (
        <Text style={[s.paragraph, { color: d.text }]}>
          <InlineContent nodes={content} textColor={d.text} />
        </Text>
      );

    case 'bulletListItem':
    case 'numberedListItem':
      return (
        <View style={s.listRow}>
          <Text style={[s.bullet, { color: d.text }]}>•</Text>
          <Text style={[s.paragraph, { flex: 1, color: d.text }]}>
            <InlineContent nodes={content} textColor={d.text} />
          </Text>
        </View>
      );

    case 'quote':
      return (
        <View style={[s.quote, { borderLeftColor: d.primary }]}>
          <Text style={[s.paragraph, { color: d.secondary }]}>
            <InlineContent nodes={content} textColor={d.secondary} />
          </Text>
        </View>
      );

    case 'codeBlock':
      return (
        <View style={[s.codeBlock, d.codeBlock]}>
          <Text style={[s.code, { color: d.text }]}>
            <InlineContent nodes={content} textColor={d.text} />
          </Text>
        </View>
      );

    case 'image': {
      const url = typeof props.url === 'string' ? props.url : '';
      const caption = typeof props.caption === 'string' ? props.caption : '';
      if (!url) return null;
      // 无尺寸信息（正文行内旧图）回退方图；有尺寸按真实比例满宽展示。
      const aspectRatio = resolveMediaAspectRatio(props, 1);
      return (
        <View>
          <View style={s.mediaFrame}>
            <Image
              source={{ uri: url }}
              style={[s.media, { aspectRatio }]}
              contentFit="cover"
              onError={onMediaError}
            />
          </View>
          {caption ? (
            <Text style={[s.caption, { color: d.secondary }]}>{caption}</Text>
          ) : null}
        </View>
      );
    }

    case 'video': {
      const url = typeof props.url === 'string' ? props.url : '';
      const caption = typeof props.caption === 'string' ? props.caption : '';
      if (!url) return null;
      return (
        <VideoBlock
          url={url}
          caption={caption}
          captionColor={d.secondary}
          aspectRatio={resolveMediaAspectRatio(props, 16 / 9)}
          backgroundColor={colors.black}
          onMediaError={onMediaError}
        />
      );
    }

    default:
      return null;
  }
}

interface Props {
  blocks: Record<string, unknown>[];
  /**
   * 媒体加载失败时回调。笔记媒体走 presign-on-read，URL 是有 TTL 的短时签名 —— 手里的
   * URL 过期后会 403，图片静默变空白。上层收到后重拉一次笔记即可拿到新签名。
   */
  onMediaError?: () => void;
}

export function NoteBlockRenderer({ blocks, onMediaError }: Props) {
  return (
    <View style={s.container}>
      {blocks.map((block, i) => (
        <BlockView
          key={typeof block.id === 'string' ? block.id : i}
          block={block}
          onMediaError={onMediaError}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: Spacing.sm },
  h1: { ...Typography.h1, marginVertical: Spacing.xs },
  h2: { ...Typography.h2, marginVertical: Spacing.xs },
  h3: { ...Typography.h3, marginVertical: Spacing.xs },
  paragraph: { ...Typography.bodyRegular, lineHeight: 24 },
  listRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  bullet: { marginTop: 3 },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  codeBlock: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
  },
  code: {
    fontFamily: 'monospace',
    ...Typography.small,
  },
  mediaFrame: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  media: { width: '100%' },
  caption: {
    ...Typography.small,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});
