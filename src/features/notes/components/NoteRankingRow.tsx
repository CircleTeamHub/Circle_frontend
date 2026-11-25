import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  NoteCardBody,
  type NoteCardSection,
} from '@/features/chat/components/bubbles/note-card-body';
import { CHAT_CARD_PADDING_VERTICAL } from '@/features/chat/components/bubbles/shared';
import {
  NoteRankBadge,
  RANK_BADGE_WIDTH,
  rankBadgeCenterY,
} from '@/features/notes/components/NoteRankBadge';
import { Radius, Spacing, useTheme } from '@/theme';
import type { NoteRankingBoard, NoteRankingItem } from '@/features/notes/types';
import type { NoteCardData } from '@/types';

export const RANK_COLUMN_WIDTH = RANK_BADGE_WIDTH;
/** 名次列与卡片之间的距离。 */
export const RANK_GAP = Spacing.sm;
/** 聊天卡片标题行的中线（内边距 + 22 行高的一半）：名次与标题对齐在这条线上。 */
const CARD_TITLE_CENTER_Y = CHAT_CARD_PADDING_VERTICAL + 11;

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: RANK_GAP },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});

interface NoteRankingRowProps {
  rank: number;
  board: NoteRankingBoard;
  note: NoteRankingItem;
  cardWidth: number;
  /** section 缺省 = 点了卡片本身；否则是卡片上的分块按钮，详情页定位到那一块。 */
  onOpen: (note: NoteRankingItem, section?: NoteCardSection) => void;
}

/** 榜单条目交给聊天里的笔记卡片画：与聊天里看到的是同一张卡。 */
function toCardData(note: NoteRankingItem): NoteCardData {
  return {
    noteId: note.id,
    ownerId: note.ownerId ?? null,
    title: note.title,
    contentPreview: note.contentPreview,
    coverUrl: note.cover?.url || null,
    previewUrls: note.previewUrls,
    imageCount: note.imageCount,
    videoCount: note.videoCount,
    groupNames: [],
    workStatus: note.workStatus ?? null,
    publicationStatus: note.status,
    hasText: note.hasText,
    showcaseCount: note.showcaseCount,
    hasLocation: note.hasLocation,
  };
}

/** 榜单一行：左边名次（好评榜前三名金银铜奖牌，其余斜体数字），右边是聊天同款笔记卡片。 */
export const NoteRankingRow = memo(function NoteRankingRow({
  rank,
  board,
  note,
  cardWidth,
  onOpen,
}: NoteRankingRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({
      rank: { marginTop: CARD_TITLE_CENTER_Y - rankBadgeCenterY(rank, board) },
      card: { borderColor: colors.surfaceBorder },
    }),
    [board, colors.surfaceBorder, rank],
  );
  const card = useMemo(() => toCardData(note), [note]);
  const ratingCounts = useMemo(
    () => ({ goodCount: note.goodCount ?? 0, badCount: note.badCount ?? 0 }),
    [note.badCount, note.goodCount],
  );
  const openCard = useCallback(() => onOpen(note), [note, onOpen]);
  const openSection = useCallback(
    (_card: NoteCardData, section: NoteCardSection) => onOpen(note, section),
    [note, onOpen],
  );

  return (
    <View style={s.row}>
      <View
        style={d.rank}
        accessible
        accessibilityLabel={t('explore.ranking.rankA11y', { defaultValue: '第 {{rank}} 名', rank })}
      >
        <NoteRankBadge rank={rank} board={board} />
      </View>
      <View style={[s.card, d.card]}>
        <NoteCardBody
          note={card}
          outgoing={false}
          width={cardWidth}
          ratingCounts={ratingCounts}
          onPress={openCard}
          onSectionPress={openSection}
        />
      </View>
    </View>
  );
});
