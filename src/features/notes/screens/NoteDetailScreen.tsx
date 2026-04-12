import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteBlockRenderer } from '@/features/notes/components/NoteBlockRenderer';
import type { NoteDetail } from '@/features/notes/types';
import { formatNoteFullDate } from '@/features/notes/utils/note-format';
import { fetchNoteDetail } from '@/services/api/notes';
import { Spacing, Typography, useTheme } from '@/theme';

export default function NoteDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchNoteDetail(id)
      .then((data) => {
        if (!cancelled) {
          setNote(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleEdit = useCallback(() => {
    if (!note) return;
    router.push(`/(tabs)/profile/notes/edit?id=${note.id}` as never);
  }, [router, note]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      title: { color: colors.text },
      meta: { color: colors.textSecondary },
      groupTag: { backgroundColor: colors.primary + '33' },
      groupTagText: { color: colors.primary },
      content: { color: colors.text },
    }),
    [colors],
  );

  if (loading) {
    return (
      <View style={[s.container, d.container, s.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!note) {
    return (
      <View style={[s.container, d.container, s.center, { paddingTop: insets.top }]}>
        <Text style={d.meta}>笔记不存在</Text>
      </View>
    );
  }

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable onPress={handleEdit} hitSlop={8}>
          <Ionicons name="create-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <Text style={[s.title, d.title]}>{note.title}</Text>

        {/* Date + group */}
        <View style={s.metaRow}>
          <Text style={[s.meta, d.meta]}>{formatNoteFullDate(note.createdAt)}</Text>
          {note.group ? (
            <View style={[s.groupTag, d.groupTag]}>
              <Text style={[s.groupTagText, d.groupTagText]}>{note.group.name}</Text>
            </View>
          ) : null}
        </View>

        {/* Body — prefer contentJson, fall back to plain content */}
        {note.contentJson && note.contentJson.length > 0 ? (
          <NoteBlockRenderer blocks={note.contentJson as Record<string, unknown>[]} />
        ) : note.content ? (
          <Text style={[s.bodyText, d.content]}>{note.content}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    height: 52,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  title: { ...Typography.h1, fontWeight: '700', marginBottom: Spacing.xs },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  meta: { ...Typography.caption },
  groupTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  groupTagText: { ...Typography.small, fontWeight: '600' },
  bodyText: { ...Typography.bodyRegular, lineHeight: 24 },
});
