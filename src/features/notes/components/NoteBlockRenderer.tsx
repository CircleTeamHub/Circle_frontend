import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useAudioPlayer, type AudioStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { toPlayableUri } from '@/features/chat/utils/media-uri';
import {
  extractInlineText,
  MAX_NOTE_BLOCK_DEPTH,
} from '@/features/notes/utils/note-blocks';

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

function ActiveVideoBlock({
  url,
  caption,
  captionColor,
  aspectRatio,
  backgroundColor,
  onMediaError,
  autoPlay = false,
}: {
  url: string;
  caption: string;
  captionColor: string;
  aspectRatio: number;
  backgroundColor: string;
  onMediaError?: () => void;
  autoPlay?: boolean;
}) {
  // useVideoPlayer is called unconditionally — the empty-url guard lives in the
  // caller (BlockView), so this component always receives a valid source.
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });
  useEffect(() => {
    // Run after VideoView attaches: the web player cannot play before it has
    // a mounted video element. Native players retain play intent while loading.
    if (autoPlay) player.play();
  }, [autoPlay, player]);
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

function VideoBlock(props: {
  url: string;
  caption: string;
  captionColor: string;
  aspectRatio: number;
  backgroundColor: string;
  onMediaError?: () => void;
  lazy?: boolean;
}) {
  const { t } = useTranslation();
  const {
    url,
    caption,
    captionColor,
    aspectRatio,
    backgroundColor,
    onMediaError,
    lazy = false,
  } = props;
  const [activated, setActivated] = useState(!lazy);

  if (!activated) {
    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.detail.playVideo')}
          onPress={() => setActivated(true)}
          style={[s.mediaFrame, { backgroundColor }]}
        >
          <View style={[s.media, s.videoPlaceholder, { aspectRatio, backgroundColor }]}>
            <View style={[s.videoPlayButton, { backgroundColor: captionColor }]}>
              <Text style={[s.videoPlayGlyph, { color: backgroundColor }]}>▶</Text>
            </View>
          </View>
        </Pressable>
        {caption ? (
          <Text style={[s.caption, { color: captionColor }]}>{caption}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <ActiveVideoBlock
      autoPlay={lazy}
      url={url}
      caption={caption}
      captionColor={captionColor}
      aspectRatio={aspectRatio}
      backgroundColor={backgroundColor}
      onMediaError={onMediaError}
    />
  );
}

function ActiveAudioBlock({
  url,
  durationMs,
  backgroundColor,
  foregroundColor,
  onMediaError,
  autoPlay = false,
}: {
  url: string;
  durationMs?: number;
  backgroundColor: string;
  foregroundColor: string;
  onMediaError?: () => void;
  autoPlay?: boolean;
}) {
  const { t } = useTranslation();
  const source = useMemo(() => ({ uri: toPlayableUri(url) }), [url]);
  const player = useAudioPlayer(source);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [resolvedDuration, setResolvedDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setResolvedDuration(0);
    const subscription = player.addListener(
      'playbackStatusUpdate',
      (status: AudioStatus) => {
        setPlaying(Boolean(status.playing));
        setCurrentTime(status.currentTime ?? 0);
        if (status.duration && status.duration > 0) setResolvedDuration(status.duration);
        if (!status.isLoaded && !status.isBuffering && status.playbackState === 'failed') {
          onMediaError?.();
        }
        if (status.didJustFinish) {
          player.pause();
          void player.seekTo(0).catch(() => undefined);
          setPlaying(false);
          setCurrentTime(0);
        }
      },
    );
    return () => subscription.remove();
  }, [onMediaError, player, url]);

  const playIntentRef = useRef(autoPlay);
  useEffect(() => {
    if (!playIntentRef.current) return;
    const playIfReady = () => {
      if (!playIntentRef.current || !player.isLoaded) return;
      playIntentRef.current = false;
      player.play();
    };
    const subscription = player.addListener('playbackStatusUpdate', playIfReady);
    playIfReady();
    return () => subscription.remove();
  }, [player]);

  const totalSeconds = Math.max(
    1,
    resolvedDuration || (typeof durationMs === 'number' ? durationMs / 1000 : 1),
  );
  const progress = Math.min(1, Math.max(0, currentTime / totalSeconds));
  const label = playing
    ? `${Math.round(currentTime)}s`
    : `${Math.round(totalSeconds)}s`;

  const handlePress = () => {
    if (playing) {
      player.pause();
      return;
    }
    if (currentTime >= totalSeconds - 0.05) void player.seekTo(0).catch(() => undefined);
    player.play();
  };

  return (
    <Pressable
      style={[s.audioCard, { backgroundColor }]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t(playing ? 'notes.accessibility.pauseRecording' : 'notes.accessibility.playRecording')}
    >
      <View style={[s.audioIcon, { backgroundColor: foregroundColor }]}>
        <Text style={[s.audioIconText, { color: backgroundColor }]}>
          {playing ? 'Ⅱ' : '▶'}
        </Text>
      </View>
      <View style={s.audioBody}>
        <View style={[s.audioTrack, { backgroundColor: foregroundColor, opacity: 0.22 }]}>
          <View
            style={[s.audioProgress, { width: `${progress * 100}%`, backgroundColor: foregroundColor }]}
          />
        </View>
        <Text style={[s.audioDuration, { color: foregroundColor }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function AudioBlock(props: {
  url: string;
  durationMs?: number;
  backgroundColor: string;
  foregroundColor: string;
  onMediaError?: () => void;
  lazy?: boolean;
}) {
  const { t } = useTranslation();
  const {
    url,
    durationMs,
    backgroundColor,
    foregroundColor,
    onMediaError,
    lazy = false,
  } = props;
  const [activated, setActivated] = useState(!lazy);

  if (!activated) {
    const durationSeconds = Math.max(
      1,
      Math.round((typeof durationMs === 'number' ? durationMs : 1000) / 1000),
    );
    return (
      <Pressable
        style={[s.audioCard, { backgroundColor }]}
        onPress={() => setActivated(true)}
        accessibilityRole="button"
        accessibilityLabel={t('notes.accessibility.playRecording')}
      >
        <View style={[s.audioIcon, { backgroundColor: foregroundColor }]}>
          <Text style={[s.audioIconText, { color: backgroundColor }]}>▶</Text>
        </View>
        <View style={s.audioBody}>
          <View style={[s.audioTrack, { backgroundColor: foregroundColor, opacity: 0.22 }]} />
          <Text style={[s.audioDuration, { color: foregroundColor }]}>{durationSeconds}s</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <ActiveAudioBlock
      autoPlay={lazy}
      url={url}
      durationMs={durationMs}
      backgroundColor={backgroundColor}
      foregroundColor={foregroundColor}
      onMediaError={onMediaError}
    />
  );
}

function ContactCard({
  card,
  group,
  onPress,
}: {
  onPress?: (id: string, name?: string) => void;
  card: Record<string, unknown>;
  group: boolean;
}) {
  const { colors } = useTheme();
  const id = group && typeof card.circleId === 'string' ? card.circleId : typeof card.id === 'string' ? card.id : '';
  const name = typeof card.name === 'string' ? card.name : '';
  const avatar =
    (typeof card.faceURL === 'string' && card.faceURL) ||
    (typeof card.avatarUrl === 'string' && card.avatarUrl) ||
    '';
  const subtitle =
    typeof card.subtitle === 'string'
      ? card.subtitle
      : typeof card.username === 'string'
        ? card.username
        : '';
  return (
    <Pressable
      style={[s.peerCard, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}
      onPress={onPress && id ? () => onPress(id, name) : undefined}
      disabled={!onPress || !id}
      accessibilityRole={onPress && id ? 'button' : undefined}
      accessibilityLabel={name || id}
    >
      {avatar ? (
        <Image source={{ uri: avatar }} style={s.peerAvatar} contentFit="cover" />
      ) : (
        <View style={[s.peerAvatar, { backgroundColor: colors.primaryLight }]}>
          <Text style={[s.peerAvatarFallback, { color: colors.primary }]}> {group ? '群' : '人'} </Text>
        </View>
      )}
      <View style={s.peerBody}>
        <Text style={[s.peerName, { color: colors.text }]} numberOfLines={1}>
          {name || id}
        </Text>
        {subtitle ? (
          <Text style={[s.peerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onPress && id ? <Text style={[s.peerChevron, { color: colors.textSecondary }]}>›</Text> : null}
    </Pressable>
  );
}

const InlineContent = memo(function InlineContent({
  nodes,
  textColor,
  depth = 0,
}: {
  nodes: unknown[];
  textColor: string;
  depth?: number;
}) {
  if (depth > MAX_NOTE_BLOCK_DEPTH) return null;
  return (
    <>
      {nodes.map((value, i) => {
        if (typeof value === 'string') return <Text key={i}>{value}</Text>;
        if (!value || typeof value !== 'object') return null;
        const node = value as InlineNode;
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
            {Array.isArray(node.content) ? (
              <InlineContent
                nodes={node.content}
                textColor={textColor}
                depth={depth + 1}
              />
            ) : null}
          </Text>
        );
      })}
    </>
  );
});

const BlockView = memo(function BlockView({
  block,
  onMediaError,
  onImagePress,
  onContactPress,
  onGroupPress,
  lazyMedia = false,
}: {
  block: Block;
  onMediaError?: () => void;
  onImagePress?: (uri: string, objectKey?: string) => void;
  onContactPress?: (id: string, name?: string) => void;
  onGroupPress?: (id: string, name?: string) => void;
  lazyMedia?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({
      text: colors.text,
      secondary: colors.text,
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
    case 'checkListItem':
    case 'toggleListItem':
      return (
        <View style={s.listRow}>
          <Text style={[s.bullet, { color: d.text }]}>
            {type === 'checkListItem' ? (props.checked ? '☑' : '☐') : '•'}
          </Text>
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
      const objectKey = typeof props.objectKey === 'string' ? props.objectKey : undefined;
      if (!url) return null;
      // 无尺寸信息（正文行内旧图）回退方图；有尺寸按真实比例满宽展示。
      const aspectRatio = resolveMediaAspectRatio(props, 1);
      return (
        <View>
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel={caption || t('notes.accessibility.viewImage')}
            onPress={() => onImagePress?.(url, objectKey)}
            disabled={!onImagePress}
            style={s.mediaFrame}
          >
            <Image
              source={{ uri: url, ...(objectKey ? { cacheKey: objectKey } : {}) }}
              recyclingKey={objectKey ?? url}
              cachePolicy="memory-disk"
              priority="low"
              allowDownscaling
              enforceEarlyResizing
              transition={0}
              style={[s.media, { aspectRatio }]}
              contentFit="cover"
              onError={onMediaError}
            />
          </Pressable>
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
          lazy={lazyMedia}
        />
      );
    }

    case 'audio': {
      const url = typeof props.url === 'string' ? props.url : '';
      if (!url) return null;
      return (
        <AudioBlock
          url={url}
          durationMs={typeof props.durationMs === 'number' ? props.durationMs : undefined}
          backgroundColor={colors.surface}
          foregroundColor={d.primary}
          onMediaError={onMediaError}
          lazy={lazyMedia}
        />
      );
    }

    case 'contact':
      return <ContactCard card={props} group={false} onPress={onContactPress} />;

    case 'group':
      return <ContactCard card={props} group onPress={onGroupPress} />;

    default: {
      // 表格和其他粘贴格式至少保留完整文字，不能因为没有专用布局就整块消失。
      const text = extractInlineText(block.content);
      return text ? <Text style={[s.paragraph, { color: d.text }]}>{text}</Text> : null;
    }
  }
});

interface Props {
  blocks: Record<string, unknown>[];
  /**
   * 媒体加载失败时回调。笔记媒体走 presign-on-read，URL 是有 TTL 的短时签名 —— 手里的
   * URL 过期后会 403，图片静默变空白。上层收到后重拉一次笔记即可拿到新签名。
   */
  onMediaError?: () => void;
  onImagePress?: (uri: string, objectKey?: string) => void;
  onContactPress?: (id: string, name?: string) => void;
  onGroupPress?: (id: string, name?: string) => void;
  lazyMedia?: boolean;
  depth?: number;
}

export const NoteBlockRenderer = memo(function NoteBlockRenderer({
  blocks,
  onMediaError,
  onImagePress,
  onContactPress,
  onGroupPress,
  lazyMedia = false,
  depth = 0,
}: Props) {
  if (depth > MAX_NOTE_BLOCK_DEPTH) return null;
  return (
    <View style={s.container}>
      {blocks.map((block, i) => block && typeof block === 'object' ? (
        <View key={typeof block.id === 'string' ? block.id : i}>
          <BlockView
            block={block}
            onMediaError={onMediaError}
            onImagePress={onImagePress}
            onContactPress={onContactPress} onGroupPress={onGroupPress}
            lazyMedia={lazyMedia}
          />
          {Array.isArray(block.children) && block.children.length > 0 ? (
            <View style={s.children}>
              <NoteBlockRenderer
                blocks={block.children}
                onMediaError={onMediaError}
                onImagePress={onImagePress}
                onContactPress={onContactPress} onGroupPress={onGroupPress}
                lazyMedia={lazyMedia}
                depth={depth + 1}
              />
            </View>
          ) : null}
        </View>
      ) : null)}
    </View>
  );
});

const s = StyleSheet.create({
  container: { gap: Spacing.sm },
  children: { paddingLeft: Spacing.md, marginTop: Spacing.sm },
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
  videoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayButton: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayGlyph: { fontSize: 18, fontWeight: '700' },
  audioCard: {
    minHeight: 58,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  audioIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioIconText: { fontSize: 14, fontWeight: '700' },
  audioBody: { flex: 1, gap: Spacing.xs },
  audioTrack: { height: 4, borderRadius: Radius.full, overflow: 'hidden' },
  audioProgress: { height: '100%', borderRadius: Radius.full },
  audioDuration: { ...Typography.small },
  peerCard: {
    minHeight: 68,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  peerAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerAvatarFallback: { ...Typography.small, fontWeight: '700' },
  peerBody: { flex: 1, gap: 2 },
  peerName: { ...Typography.body, fontWeight: '600' },
  peerSubtitle: { ...Typography.small },
  peerChevron: { fontSize: 24, lineHeight: 24 },
  caption: {
    ...Typography.small,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});
