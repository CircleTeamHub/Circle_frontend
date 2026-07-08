import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NoteSummary } from '@/features/notes/types';
import { buildNoteMeta } from '@/features/notes/utils/note-format';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface Props {
  note: NoteSummary;
  /** 回调统一携带 note，父层可用稳定的 useCallback，让 memo 生效 */
  onPress: (note: NoteSummary) => void;
  /** 点「⋯」打开动作菜单（置顶/编辑/分享/下架）——由父层承载菜单 */
  onMorePress?: (note: NoteSummary) => void;
  showActions?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'button';
}

function NoteCardInner({
  note,
  onPress,
  onMorePress,
  showActions = true,
  accessibilityLabel,
  accessibilityRole = 'button',
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      title: { color: colors.text },
      preview: { color: colors.textSecondary },
      meta: { color: colors.textSecondary },
      placeholder: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
    }),
    [colors],
  );

  const meta = buildNoteMeta(
    {
      updatedAt: note.updatedAt,
      groupNames: note.groups.map((group) => group.name),
      imageCount: note.imageCount,
      videoCount: note.videoCount,
    },
    t,
  );

  // 收藏来的笔记在列表上标出来源（群/用户名），点进详情可跳回原消息。
  const sourceName = note.collectedFrom
    ? note.collectedFrom.conversationType === 'group'
      ? note.collectedFrom.group?.name
      : note.collectedFrom.sender?.name
    : null;

  const handlePress = useCallback(() => onPress(note), [note, onPress]);

  const handleMore = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onMorePress?.(note);
    },
    [note, onMorePress],
  );

  const canShowActions = showActions && Boolean(onMorePress);

  return (
    <Pressable
      style={s.container}
      onPress={handlePress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      {note.cover ? (
        <Image source={{ uri: note.cover.url }} recyclingKey={note.cover.url} style={s.thumbnail} contentFit="cover" />
      ) : (
        <View style={[s.thumbnail, s.thumbnailFallback, d.placeholder]}>
          <Ionicons
            name="document-text-outline"
            size={22}
            color={colors.textSecondary}
          />
        </View>
      )}

      <View style={s.content}>
        <View style={s.titleRow}>
          {note.pinned ? (
            <Ionicons name="bookmark" size={13} color={colors.primary} />
          ) : null}
          <Text style={[s.title, d.title]} numberOfLines={1}>
            {note.title}
          </Text>
        </View>
        {note.contentPreview ? (
          <Text style={[s.preview, d.preview]} numberOfLines={2}>
            {note.contentPreview}
          </Text>
        ) : null}
        <Text style={[s.meta, d.meta]} numberOfLines={1}>
          {meta}
        </Text>
        {sourceName ? (
          <View style={s.sourceRow}>
            <Ionicons
              name={
                note.collectedFrom?.conversationType === 'group'
                  ? 'chatbubbles-outline'
                  : 'chatbubble-outline'
              }
              size={11}
              color={colors.primary}
            />
            <Text style={[s.sourceText, { color: colors.primary }]} numberOfLines={1}>
              {t('notes.list.fromSource', {
                defaultValue: '来自 {{name}}',
                name: sourceName,
              })}
            </Text>
          </View>
        ) : null}
      </View>

      {canShowActions ? (
        <Pressable
          onPress={handleMore}
          hitSlop={10}
          style={s.moreBtn}
          accessibilityRole="button"
          accessibilityLabel={t('notes.actions.more', { defaultValue: '更多' })}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

// 列表页搜索/刷新时高频重渲，note 数据没变的卡片直接跳过。
export const NoteCard = memo(NoteCardInner);

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: Radius.md,
    flexShrink: 0,
  },
  thumbnailFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  title: {
    flexShrink: 1,
    ...Typography.body,
    fontWeight: '600',
  },
  preview: {
    ...Typography.caption,
    fontWeight: '400',
    lineHeight: 18,
  },
  meta: {
    ...Typography.small,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  sourceText: {
    ...Typography.small,
    fontWeight: '500',
  },
  moreBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -2,
  },
});
