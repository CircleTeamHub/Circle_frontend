import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type Block = Record<string, unknown>;
type InlineNode = Record<string, unknown>;

function VideoBlock({
  url,
  caption,
  captionColor,
  frameStyle,
}: {
  url: string;
  caption: string;
  captionColor: string;
  frameStyle: { backgroundColor: string; borderColor: string };
}) {
  // useVideoPlayer is called unconditionally — the empty-url guard lives in the
  // caller (BlockView), so this component always receives a valid source.
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });
  return (
    <View>
      <View style={[s.mediaFrame, frameStyle]}>
        <VideoView
          style={s.media}
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

function BlockView({ block }: { block: Block }) {
  const { colors } = useTheme();
  const d = useMemo(
    () => ({
      text: colors.text,
      secondary: colors.textSecondary,
      primary: colors.primary,
      // 竖图 contain 后两侧会露底：垫页面底色 + 细边做成"相框"，
      // 留白读起来是刻意的卡纸而不是没铺满；在 surface 小节卡片里也有层次。
      mediaFrame: {
        backgroundColor: colors.background,
        borderColor: colors.surfaceBorder,
      },
      codeBlock: {
        backgroundColor: colors.background,
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
      return (
        <View>
          <View style={[s.mediaFrame, d.mediaFrame]}>
            <Image source={{ uri: url }} style={s.media} contentFit="contain" />
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
          frameStyle={d.mediaFrame}
        />
      );
    }

    default:
      return null;
  }
}

interface Props {
  blocks: Record<string, unknown>[];
}

export function NoteBlockRenderer({ blocks }: Props) {
  return (
    <View style={s.container}>
      {blocks.map((block, i) => (
        <BlockView key={typeof block.id === 'string' ? block.id : i} block={block} />
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
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  media: { width: '100%', height: 300 },
  caption: {
    ...Typography.small,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});
