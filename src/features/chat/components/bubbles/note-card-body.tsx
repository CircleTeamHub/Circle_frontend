import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NoteRatingCounts } from '@/features/notes/components/NoteRatingCounts';
import { useNoteRatingCountsStore } from '@/features/notes/store/use-note-rating-counts-store';
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
/** 左右内边距收到 12,把宽度让给四宫格:标题区和图片是主角,按钮只是小标签。 */
const CARD_PADDING_HORIZONTAL = Spacing.sm + Spacing.xs;
const CARD_INNER_WIDTH = CHAT_CARD_STANDARD_WIDTH - CARD_PADDING_HORIZONTAL * 2;
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
    paddingHorizontal: CARD_PADDING_HORIZONTAL,
    // 块与块之间留足空隙:标题区 / 四宫格 / 按钮三段分得开,不挤。
    gap: Spacing.sm + Spacing.xs,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  cover: { width: 56, height: 56, borderRadius: Radius.sm },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: 16, fontWeight: '700', lineHeight: 22, flexShrink: 1 },
  preview: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  meta: { ...Typography.small, lineHeight: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metaText: { flexShrink: 1 },
  // 与笔记页的开工/打烊/下架标签同一套实心底(noteWorkStatusFill + onStatusFill)。
  statusPill: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  statusText: { ...Typography.small, fontWeight: '700' },
  unlisted: { ...Typography.small, fontWeight: '600' },
  grid: { flexDirection: 'row', gap: GRID_GAP },
  tile: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: Radius.sm, overflow: 'hidden' },
  tileImage: { width: '100%', height: '100%' },
  // 按钮是小方块标签:宽度随文字、靠左排,不和图片抢视觉。
  chips: { flexDirection: 'row', gap: Spacing.xs + 2 },
  chip: {
    height: 22,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipEnabled: { backgroundColor: NOTE_CARD_ACTIVE_GREEN },
  chipDisabled: { borderWidth: 1 },
  chipText: { ...Typography.tinyRegular, fontWeight: '600' },
});

/**
 * 聊天里的笔记卡片主体:标题(右侧状态标签)→ 一行简介 → 图片/视频数 → 四宫格 → 可直接发送的分块。
 * 有四宫格就不放左上角封面(图都在格子里);旧卡片没有四宫格才保留小封面。
 * 四个分块按钮始终都在:有的那块是绿色实心,点一下以我的名义把那部分发到当前聊天;没有的是灰色描边。
 */
export function NoteCardBody({ note, outgoing, onPress, onSectionPress, onLongPress }: NoteCardBodyProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const onCard = outgoing ? colors.white : colors.text;
  const onCardMuted = outgoing ? 'rgba(255,255,255,0.78)' : colors.text;
  const previewUrls = note.previewUrls ?? [];
  const hasPreviews = previewUrls.length > 0;
  const unlisted = note.publicationStatus === 'UNLISTED' || note.publicationStatus === 'DELETED';
  // This month's counters of the source note. They arrive with the conversation's
  // source-state reconciliation, or right after the viewer rates from the menu;
  // until then the area shows 0 so the card keeps its height.
  const ratingCounts = useNoteRatingCountsStore((state) => state.counts[note.noteId]);

  const available: Record<NoteCardSection, boolean> = {
    text: note.hasText ?? Boolean(note.contentPreview && note.contentPreview.trim()),
    media: note.videoCount > 0,
    showcase: (note.showcaseCount ?? note.imageCount) > 0,
    location: note.hasLocation ?? false,
  };

  const countSegments = [
    note.imageCount > 0
      ? t('chat.noteCard.imageCount', { defaultValue: '{{count}}张图片', count: note.imageCount })
      : null,
    note.videoCount > 0
      ? t('chat.noteCard.videoCount', { defaultValue: '{{count}}个视频', count: note.videoCount })
      : null,
  ].filter((segment): segment is string => segment !== null);

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
          <View style={s.metaRow}>
            {countSegments.length > 0 ? (
              <Text style={[s.meta, s.metaText, { color: onCardMuted }]} numberOfLines={1} testID="note-card-counts">
                {countSegments.join(' · ')}
              </Text>
            ) : null}
            <NoteRatingCounts
              goodCount={ratingCounts?.goodCount}
              badCount={ratingCounts?.badCount}
              color={onCardMuted}
              testID="note-card-rating"
            />
          </View>
        </View>
      </View>

      {hasPreviews ? (
        <View style={s.grid} testID="note-card-previews">
          {previewUrls.map((uri) => (
            <View key={uri} style={[s.tile, { backgroundColor: 'rgba(0,0,0,0.12)' }]}>
              <Image
                source={{ uri }}
                style={s.tileImage}
                contentFit="cover"
                recyclingKey={uri}
                accessibilityIgnoresInvertColors
              />
            </View>
          ))}
        </View>
      ) : null}

      {/* 四个按钮始终都在、和四宫格对齐;这条笔记没有的那块是描边灰钮、点不了,
          每张卡片的排版因此一致。 */}
      <View style={s.chips}>
        {SECTIONS.map((section) => {
          const enabled = available[section.id];
          return (
            <Pressable
              key={section.id}
              style={({ pressed }) => [
                s.chip,
                enabled
                  ? s.chipEnabled
                  : [s.chipDisabled, { borderColor: onCardMuted }],
                enabled && pressed && { opacity: 0.75 },
              ]}
              disabled={!enabled}
              onLongPress={onLongPress}
              delayLongPress={350}
              onPress={enabled && onSectionPress ? () => onSectionPress(note, section.id) : undefined}
              accessibilityState={{ disabled: !enabled }}
            >
              <Text style={[s.chipText, { color: enabled ? colors.white : onCardMuted }]}>
                {t(section.labelKey, { defaultValue: section.defaultLabel })}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Pressable>
  );
}
