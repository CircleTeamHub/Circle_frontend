import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isSetNoteWorkStatus, noteWorkStatusFill } from '@/features/notes/utils/work-status';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { NoteCardData } from '@/types';
import { CHAT_CARD_PADDING_VERTICAL, CHAT_CARD_STANDARD_WIDTH } from './shared';

export type NoteCardSection = 'text' | 'media' | 'showcase' | 'location';

interface NoteCardBodyProps {
  note: NoteCardData;
  outgoing: boolean;
  onPress?: (note: NoteCardData) => void;
  onSectionPress?: (note: NoteCardData, section: NoteCardSection) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
}

const NOTE_CARD_ACTIVE_GREEN = '#16A34A';
const GRID_GAP = 4;
const CARD_INNER_WIDTH = CHAT_CARD_STANDARD_WIDTH - Spacing.md * 2;
/** 最多 4 张等宽方图;不足 4 张保持同样大小、靠左排。 */
const TILE_SIZE = Math.floor((CARD_INNER_WIDTH - GRID_GAP * 3) / 4);

const SECTIONS: {
  id: NoteCardSection;
  labelKey: string;
  defaultLabel: string;
}[] = [
  { id: 'text', labelKey: 'chat.noteCard.chips.note', defaultLabel: '笔记' },
  { id: 'media', labelKey: 'chat.noteCard.chips.video', defaultLabel: '视频' },
  { id: 'showcase', labelKey: 'chat.noteCard.chips.display', defaultLabel: '展示' },
  { id: 'location', labelKey: 'chat.noteCard.chips.location', defaultLabel: '位置' },
];

const s = StyleSheet.create({
  card: {
    width: CHAT_CARD_STANDARD_WIDTH,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    paddingVertical: CHAT_CARD_PADDING_VERTICAL,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  cover: { width: 48, height: 48, borderRadius: Radius.sm },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { ...Typography.body, fontWeight: '700', flexShrink: 1 },
  preview: { ...Typography.small, lineHeight: 18 },
  // 与笔记页的开工/打烊/下架标签同一套实心底(noteWorkStatusFill + onStatusFill)。
  statusPill: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  statusText: { ...Typography.tiny, fontWeight: '700' },
  unlisted: { ...Typography.tiny, fontWeight: '600' },
  grid: { flexDirection: 'row', gap: GRID_GAP },
  tile: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: Radius.sm, overflow: 'hidden' },
  tileImage: { width: '100%', height: '100%' },
  moreOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  moreText: { ...Typography.body, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  counts: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 0 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  countText: { ...Typography.tinyRegular },
  chips: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    minHeight: 24,
    paddingHorizontal: Spacing.sm + 2,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NOTE_CARD_ACTIVE_GREEN,
  },
  chipText: { ...Typography.tiny, fontWeight: '700' },
});

/**
 * 聊天里的笔记卡片主体:标题(右侧状态标签)→ 一行简介 → 四宫格 → 图片/视频数 + 可直接发送的分块。
 * 有四宫格就不放左上角封面(图都在格子里);旧卡片没有四宫格才保留小封面。
 * 只列出这条笔记真的有的分块,点一下以我的名义把那部分发到当前聊天。
 */
export function NoteCardBody({ note, outgoing, onPress, onSectionPress, onLongPress }: NoteCardBodyProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const onCard = outgoing ? colors.white : colors.text;
  const onCardMuted = outgoing ? 'rgba(255,255,255,0.78)' : colors.text;
  const previewUrls = note.previewUrls ?? [];
  const hasPreviews = previewUrls.length > 0;
  const mediaTotal = note.imageCount + note.videoCount;
  const hiddenMedia = hasPreviews ? Math.max(0, mediaTotal - previewUrls.length) : 0;
  const unlisted = note.publicationStatus === 'UNLISTED' || note.publicationStatus === 'DELETED';

  const available: Record<NoteCardSection, boolean> = {
    text: note.hasText ?? Boolean(note.contentPreview && note.contentPreview.trim()),
    media: note.videoCount > 0,
    showcase: (note.showcaseCount ?? note.imageCount) > 0,
    location: note.hasLocation ?? false,
  };
  const sections = SECTIONS.filter((section) => available[section.id]);

  const countSegments = [
    note.imageCount > 0
      ? t('chat.noteCard.imageCount', { defaultValue: '{{count}}张图片', count: note.imageCount })
      : null,
    note.videoCount > 0
      ? t('chat.noteCard.videoCount', { defaultValue: '{{count}}个视频', count: note.videoCount })
      : null,
  ].filter((segment): segment is string => segment !== null);
  const countsLabel = countSegments.length
    ? t('chat.noteCard.includes', { defaultValue: '包含: {{segments}}', segments: countSegments.join('|') })
    : undefined;

  const statusNode = unlisted ? (
    <Text style={[s.unlisted, { color: colors.warning }]} numberOfLines={1}>
      {t('chat.noteCard.workStatus.unlisted', { defaultValue: '已下架，状态可能变化' })}
    </Text>
  ) : isSetNoteWorkStatus(note.workStatus) ? (
    <View style={[s.statusPill, { backgroundColor: noteWorkStatusFill(note.workStatus, colors) }]}>
      <Text style={[s.statusText, { color: colors.onStatusFill }]}>
        {note.workStatus === 'WORKING'
          ? t('chat.noteCard.workStatus.working', { defaultValue: '开工' })
          : note.workStatus === 'CLOSED'
            ? t('chat.noteCard.workStatus.closed', { defaultValue: '打烊' })
            : t('chat.noteCard.workStatus.offShelf', { defaultValue: '下架' })}
      </Text>
    </View>
  ) : null;

  return (
    <Pressable
      style={[s.card, { backgroundColor: outgoing ? colors.sentBubble : colors.receivedBubble }]}
      onPress={onPress ? () => onPress(note) : undefined}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
      <View style={s.header}>
        {hasPreviews ? null : note.coverUrl ? (
          <Image
            source={{ uri: note.coverUrl }}
            style={s.cover}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
            // 封面来自对端可控的卡片 payload，尺寸无从预判；理由同 image-bubble。
            enforceEarlyResizing
          />
        ) : (
          <View style={[s.cover, s.coverPlaceholder, { backgroundColor: 'rgba(0,0,0,0.12)' }]}>
            <Ionicons name="document-text-outline" size={22} color={onCardMuted} />
          </View>
        )}
        <View style={s.headerText}>
          <View style={s.titleRow}>
            <Text style={[s.title, { color: onCard }]} numberOfLines={1}>
              {note.title}
            </Text>
            {unlisted ? null : statusNode}
          </View>
          {unlisted ? statusNode : null}
          {note.contentPreview ? (
            <Text style={[s.preview, { color: onCardMuted }]} numberOfLines={1}>
              {note.contentPreview}
            </Text>
          ) : null}
        </View>
      </View>

      {hasPreviews ? (
        <View style={s.grid} testID="note-card-previews">
          {previewUrls.map((uri, index) => (
            <View key={uri} style={[s.tile, { backgroundColor: 'rgba(0,0,0,0.12)' }]}>
              <Image
                source={{ uri }}
                style={s.tileImage}
                contentFit="cover"
                recyclingKey={uri}
                accessibilityIgnoresInvertColors
              />
              {hiddenMedia > 0 && index === previewUrls.length - 1 ? (
                <View style={s.moreOverlay} testID="note-card-more">
                  <Text style={[s.moreText, { color: colors.white }]}>+{hiddenMedia}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {countsLabel || sections.length > 0 ? (
        <View style={s.footer}>
          {countsLabel ? (
            <View style={s.counts} accessible accessibilityLabel={countsLabel} testID="note-card-counts">
              {note.imageCount > 0 ? (
                <View style={s.count}>
                  <Ionicons name="image-outline" size={13} color={onCardMuted} />
                  <Text style={[s.countText, { color: onCardMuted }]}>{note.imageCount}</Text>
                </View>
              ) : null}
              {note.videoCount > 0 ? (
                <View style={s.count}>
                  <Ionicons name="videocam-outline" size={14} color={onCardMuted} />
                  <Text style={[s.countText, { color: onCardMuted }]}>{note.videoCount}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={s.chips}>
            {sections.map((section) => (
              <Pressable
                key={section.id}
                style={s.chip}
                onLongPress={onLongPress}
                delayLongPress={350}
                onPress={onSectionPress ? () => onSectionPress(note, section.id) : undefined}
              >
                <Text style={[s.chipText, { color: colors.white }]}>
                  {t(section.labelKey, { defaultValue: section.defaultLabel })}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}
