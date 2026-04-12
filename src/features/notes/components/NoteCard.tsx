import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NoteSummary } from '@/features/notes/types';
import { buildNoteMeta } from '@/features/notes/utils/note-format';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface Props {
  note: NoteSummary;
  onPress: () => void;
  onEditPress: () => void;
  onPinPress: () => void;
}

export function NoteCard({ note, onPress, onEditPress, onPinPress }: Props) {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      title: { color: colors.text },
      preview: { color: colors.textSecondary },
      meta: { color: colors.textSecondary },
      placeholder: { backgroundColor: colors.surface },
      pinIcon: note.pinned ? colors.primary : colors.textSecondary,
    }),
    [colors, note.pinned],
  );

  const meta = buildNoteMeta({
    updatedAt: note.updatedAt,
    groupName: note.group?.name,
    imageCount: note.imageCount,
    videoCount: note.videoCount,
  });

  const handlePin = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onPinPress();
    },
    [onPinPress],
  );

  const handleEdit = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onEditPress();
    },
    [onEditPress],
  );

  return (
    <Pressable style={s.container} onPress={onPress}>
      {note.cover ? (
        <Image source={{ uri: note.cover.url }} style={s.thumbnail} contentFit="cover" />
      ) : (
        <View style={[s.thumbnail, d.placeholder]} />
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
      </View>

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
    </Pressable>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm + 4,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: Radius.sm,
    flexShrink: 0,
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
  },
  meta: {
    ...Typography.small,
  },
  actions: {
    gap: Spacing.sm,
    alignItems: 'center',
    paddingTop: 2,
  },
});
