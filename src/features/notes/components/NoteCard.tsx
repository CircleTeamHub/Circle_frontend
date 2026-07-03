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
  onEditPress?: (note: NoteSummary) => void;
  onPinPress?: (note: NoteSummary) => void;
  showActions?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'button';
}

function NoteCardInner({
  note,
  onPress,
  onEditPress,
  onPinPress,
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
      pinIcon: note.pinned ? colors.primary : colors.textSecondary,
    }),
    [colors, note.pinned],
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

  const handlePin = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onPinPress?.(note);
    },
    [note, onPinPress],
  );

  const handleEdit = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onEditPress?.(note);
    },
    [note, onEditPress],
  );

  const canShowActions = showActions && onPinPress && onEditPress;

  return (
    <Pressable
      style={s.container}
      onPress={handlePress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      {note.cover ? (
        <Image source={{ uri: note.cover.url }} style={s.thumbnail} contentFit="cover" />
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
        <Text style={[s.title, d.title]} numberOfLines={1}>
          {note.title}
        </Text>
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
        <View style={s.actions}>
          <Pressable onPress={handlePin} hitSlop={8}>
            <Ionicons
              name={note.pinned ? 'bookmark' : 'bookmark-outline'}
              size={20}
              color={d.pinIcon}
            />
          </Pressable>
          <Pressable onPress={handleEdit} hitSlop={8}>
            <Ionicons name="create-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
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
  title: {
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
  actions: {
    gap: Spacing.sm,
    alignItems: 'center',
    paddingTop: 2,
  },
});
