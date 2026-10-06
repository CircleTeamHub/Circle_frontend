import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/stores/authStore';
import { fetchNoteDrafts, deleteNoteDraft } from '@/services/api/notes';
import type { NoteDraftSummary } from '@/features/notes/types';
import {
  loadLocalNoteDraftSummaries,
  removeLocalNoteDraft,
  type NoteLocalDraftSummary,
} from '@/features/notes/utils/note-editor-drafts';
import { formatNoteDate } from '@/features/notes/utils/note-format';
import { Spacing, Typography, useTheme } from '@/theme';

type DraftListItem = NoteLocalDraftSummary & { synced: boolean };

function mergeDrafts(
  local: NoteLocalDraftSummary[],
  remote: NoteDraftSummary[],
): DraftListItem[] {
  const byId = new Map<string, DraftListItem>();
  for (const item of local) byId.set(item.id, { ...item, synced: false });
  for (const item of remote) {
    const remoteItem: DraftListItem = {
      id: item.id,
      noteId: item.sourceNoteId ?? null,
      title: item.title,
      contentPreview: item.contentPreview ?? '',
      mediaCount: item.mediaCount,
      createdAt: Date.parse(item.createdAt) || Date.now(),
      updatedAt: Date.parse(item.updatedAt) || Date.now(),
      synced: true,
    };
    const current = byId.get(item.id);
    if (!current || remoteItem.updatedAt >= current.updatedAt) {
      byId.set(item.id, remoteItem);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export default function DraftsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const userId = useAuthStore((state) => state.user?.id);
  const [items, setItems] = useState<DraftListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const local = loadLocalNoteDraftSummaries(userId);
    setItems(mergeDrafts(local, []));
    setLoading(false);
    try {
      const remote = await fetchNoteDrafts();
      if (mountedRef.current) setItems(mergeDrafts(loadLocalNoteDraftSummaries(userId), remote));
    } catch {
      // Local drafts remain available while offline; the next focus retries sync.
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      void load();
      return () => {
        mountedRef.current = false;
      };
    }, [load]),
  );

  const openDraft = useCallback(
    (item: DraftListItem) => {
      router.push({
        pathname: '/(tabs)/profile/notes/edit',
        params: {
          draftId: item.id,
          ...(item.noteId ? { id: item.noteId } : {}),
        },
      } as never);
    },
    [router],
  );

  const removeDraft = useCallback(
    (item: DraftListItem) => {
      Alert.alert(
        t('notes.drafts.deleteTitle', { defaultValue: '删除草稿？' }),
        t('notes.drafts.deleteMessage', { defaultValue: '删除后无法恢复。' }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('common.delete', { defaultValue: '删除' }),
            style: 'destructive',
            onPress: () => {
              removeLocalNoteDraft(userId, item.id);
              setItems((current) => current.filter((draft) => draft.id !== item.id));
              void deleteNoteDraft(item.id).catch(() => undefined);
            },
          },
        ],
      );
    },
    [t, userId],
  );

  const empty = useMemo(
    () => (
      <View style={s.empty}>
        <Ionicons name="document-text-outline" size={42} color={colors.textSecondary} />
        <Text style={[s.emptyText, { color: colors.textSecondary }]}> 
          {t('notes.drafts.empty', { defaultValue: '草稿箱是空的' })}
        </Text>
      </View>
    ),
    [colors.textSecondary, t],
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}> 
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Ionicons name="chevron-back" size={25} color={colors.text} />
        </Pressable>
        <Text style={[s.title, { color: colors.text }]}> 
          {t('notes.drafts.title', { defaultValue: '草稿箱' })}
        </Text>
        <View style={s.headerSpacer} />
      </View>
      {loading && items.length === 0 ? (
        <ActivityIndicator style={s.loading} color={colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[s.list, items.length === 0 && s.emptyList, { paddingBottom: insets.bottom + Spacing.xl }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={empty}
          renderItem={({ item }) => (
            <Pressable
              style={[s.card, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}
              onPress={() => openDraft(item)}
              accessibilityRole="button"
            >
              <View style={s.cardBody}>
                <Text style={[s.cardTitle, { color: colors.text }]} numberOfLines={1}>
                  {item.title.trim() || '未命名笔记'}
                </Text>
                <Text style={[s.preview, { color: colors.textSecondary }]} numberOfLines={2}>
                  {item.contentPreview || '尚未添加内容'}
                </Text>
                <Text style={[s.meta, { color: colors.textSecondary }]}> 
                  {formatNoteDate(new Date(item.updatedAt).toISOString())}
                  {item.mediaCount > 0 ? ` · ${item.mediaCount} 个媒体` : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => removeDraft(item)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="删除草稿"
              >
                <Ionicons name="trash-outline" size={21} color={colors.textSecondary} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 62,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { ...Typography.h2, fontWeight: '700' },
  headerSpacer: { width: 25 },
  list: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  emptyList: { flexGrow: 1 },
  loading: { marginTop: Spacing.xl },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    minHeight: 118,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  cardBody: { flex: 1, gap: 5 },
  cardTitle: { ...Typography.body, fontWeight: '700' },
  preview: { ...Typography.bodyRegular, lineHeight: 20 },
  meta: { ...Typography.caption },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  emptyText: { ...Typography.body },
});
