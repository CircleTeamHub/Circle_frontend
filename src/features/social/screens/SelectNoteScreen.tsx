import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';
import type { NoteSummary } from '@/features/notes/types';
import { fetchNotes } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  searchBox: {
    height: 42,
    borderRadius: Radius.xl,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...Typography.bodyRegular,
    padding: 0,
  },
  clearRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  noteRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  noteBody: {
    flex: 1,
    gap: 4,
  },
  noteTitle: {
    ...Typography.body,
  },
  notePreview: {
    ...Typography.small,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingBottom: Spacing.xxl,
  },
  emptyText: {
    ...Typography.bodyRegular,
  },
});

export default function SelectNoteScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const selectedNote = usePostFormStore((state) => state.selectedNote);
  const setSelectedNote = usePostFormStore((state) => state.setSelectedNote);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchNotes({ status: 'ACTIVE' })
      .then((data) => {
        if (!cancelled) setNotes(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '笔记加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(q) ||
        (note.contentPreview ?? '').toLowerCase().includes(q),
    );
  }, [notes, search]);

  const handleSelectNote = useCallback(
    (note: NoteSummary) => {
      setSelectedNote({ id: note.id, title: note.title });
      router.back();
    },
    [setSelectedNote],
  );

  const handleClearNote = useCallback(() => {
    setSelectedNote(null);
    router.back();
  }, [setSelectedNote]);

  const renderNote = useCallback(
    ({ item }: { item: NoteSummary }) => {
      const checked = selectedNote?.id === item.id;
      return (
        <Pressable
          style={s.noteRow}
          onPress={() => handleSelectNote(item)}
          accessibilityRole="button"
          accessibilityLabel={`选择笔记 ${item.title}`}
        >
          <View style={s.noteBody}>
            <Text style={[s.noteTitle, { color: colors.text }]} numberOfLines={1}>
              {item.title}
            </Text>
            {item.contentPreview ? (
              <Text
                style={[s.notePreview, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {item.contentPreview}
              </Text>
            ) : null}
          </View>
          {checked ? (
            <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
          ) : null}
        </Pressable>
      );
    },
    [colors, handleSelectNote, selectedNote],
  );

  return (
    <View
      style={[
        s.container,
        { paddingTop: insets.top, backgroundColor: colors.background },
      ]}
    >
      <NavHeader title="选择笔记" />
      <View style={s.content}>
        <View
          style={[
            s.searchBox,
            {
              backgroundColor: colors.surface,
              borderColor: colors.surfaceBorder,
            },
          ]}
        >
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="输入笔记标题"
            placeholderTextColor={colors.textSecondary}
            style={[s.searchInput, { color: colors.text }]}
            returnKeyType="search"
          />
        </View>

        <Pressable
          style={s.clearRow}
          onPress={handleClearNote}
          accessibilityRole="button"
          accessibilityLabel="不关联笔记"
        >
          <Text style={[Typography.body, { color: colors.text }]}>
            不关联笔记
          </Text>
          {!selectedNote ? (
            <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
          ) : null}
        </Pressable>
        <Divider />

        {loading ? (
          <View style={s.empty}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={s.empty}>
            <Text style={[s.emptyText, { color: colors.textSecondary }]}>
              {error}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredNotes}
            keyExtractor={(item) => item.id}
            renderItem={renderNote}
            ItemSeparatorComponent={Divider}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={[s.emptyText, { color: colors.textSecondary }]}>
                  没有可关联的笔记
                </Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );
}
