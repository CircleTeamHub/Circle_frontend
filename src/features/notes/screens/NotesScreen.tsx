import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteCard } from '@/features/notes/components/NoteCard';
import type { NoteGroup, NoteSummary } from '@/features/notes/types';
import {
  deleteNote,
  fetchNoteGroups,
  fetchNotes,
  togglePinNote,
} from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type TabId = 'all' | 'ungrouped' | string;

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [showUnlisted, setShowUnlisted] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [notesData, groupsData] = await Promise.all([
      fetchNotes({ status: showUnlisted ? 'UNLISTED' : 'ACTIVE' }),
      fetchNoteGroups(),
    ]);
    setNotes(notesData);
    setGroups(groupsData);
    setLoading(false);
  }, [showUnlisted]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const filteredNotes = useMemo(() => {
    let result = notes;
    if (activeTab === 'ungrouped') result = result.filter((n) => !n.group);
    else if (activeTab !== 'all') result = result.filter((n) => n.group?.id === activeTab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          (n.contentPreview ?? '').toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [notes, activeTab, search]);

  const ungroupedCount = useMemo(() => notes.filter((n) => !n.group).length, [notes]);

  const tabs = useMemo(
    () => [
      { id: 'all' as TabId, label: `全部 ${notes.length}` },
      { id: 'ungrouped' as TabId, label: `未分组 ${ungroupedCount}` },
      ...groups.map((g) => ({ id: g.id, label: `${g.name} ${g.noteCount}` })),
    ],
    [notes.length, ungroupedCount, groups],
  );

  const handlePin = useCallback(async (note: NoteSummary) => {
    await togglePinNote(note.id, !note.pinned);
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)),
    );
  }, []);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      header: { backgroundColor: colors.background },
      headerTitle: { color: colors.text },
      unlistedBtn: {
        backgroundColor: showUnlisted ? colors.primary : colors.surface,
      },
      unlistedBtnText: {
        color: showUnlisted ? colors.white : colors.text,
      },
      tabActive: { color: colors.text },
      tabInactive: { color: colors.textSecondary },
      tabActiveLine: { backgroundColor: colors.primary },
      statsText: { color: colors.textSecondary },
      searchWrap: { backgroundColor: colors.surface },
      searchInput: { color: colors.text },
      searchPlaceholder: colors.textSecondary,
      divider: { backgroundColor: colors.surface },
      bottomBar: { backgroundColor: colors.surface },
      newBtn: { backgroundColor: colors.primary },
      newBtnText: { color: colors.white },
      otherBtnText: { color: colors.text },
    }),
    [colors, showUnlisted],
  );

  const renderNote = useCallback(
    ({ item }: { item: NoteSummary }) => (
      <NoteCard
        note={item}
        onPress={() => router.push(`/(tabs)/profile/notes/${item.id}`)}
        onEditPress={() =>
          router.push(`/(tabs)/profile/notes/edit?id=${item.id}` as never)
        }
        onPinPress={() => handlePin(item)}
      />
    ),
    [router, handlePin],
  );

  const statsText = `共 ${groups.length} 个分组，合计 ${notes.length} 条笔记`;

  return (
    <View style={[s.container, d.container]}>
      {/* Header */}
      <View style={[s.header, d.header, { paddingTop: insets.top + 8 }]}>
        <View style={s.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[s.headerTitle, d.headerTitle]}>我的笔记</Text>
          <View style={s.headerRight}>
            <Pressable
              style={[s.unlistedBtn, d.unlistedBtn]}
              onPress={() => setShowUnlisted((v) => !v)}
            >
              <Text style={[s.unlistedBtnText, d.unlistedBtnText]}>已下架</Text>
            </Pressable>
            <Pressable hitSlop={8}>
              <Ionicons name="trash-outline" size={22} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={() => router.push('/(tabs)/profile/notes/edit' as never)}
            >
              <Ionicons name="add" size={24} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {/* Group tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.tabsScroll}
          contentContainerStyle={s.tabsContent}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <Pressable key={tab.id} style={s.tab} onPress={() => setActiveTab(tab.id)}>
                <Text style={[s.tabText, isActive ? d.tabActive : d.tabInactive]}>
                  {tab.label}
                </Text>
                {isActive && <View style={[s.tabLine, d.tabActiveLine]} />}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Stats */}
        <Text style={[s.statsText, d.statsText]}>{statsText}</Text>

        {/* Search */}
        <View style={[s.searchWrap, d.searchWrap]}>
          <Ionicons name="search-outline" size={16} color={d.searchPlaceholder} />
          <TextInput
            style={[s.searchInput, d.searchInput]}
            placeholder="输入你想搜索的内容"
            placeholderTextColor={d.searchPlaceholder}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {/* Note list */}
      <FlatList
        data={filteredNotes}
        keyExtractor={(item) => item.id}
        renderItem={renderNote}
        ItemSeparatorComponent={() => <View style={[s.divider, d.divider]} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      />

      {/* Bottom action bar */}
      <View style={[s.bottomBar, d.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable style={s.bottomBtn}>
          <Ionicons name="share-outline" size={18} color={colors.text} />
          <Text style={[s.bottomBtnText, d.otherBtnText]}>分享</Text>
        </Pressable>
        <Pressable style={s.bottomBtn}>
          <Ionicons name="qr-code-outline" size={18} color={colors.text} />
          <Text style={[s.bottomBtnText, d.otherBtnText]}>二维码</Text>
        </Pressable>
        <Pressable
          style={[s.bottomBtn, s.newBtnShape, d.newBtn]}
          onPress={() => router.push('/(tabs)/profile/notes/edit' as never)}
        >
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={[s.bottomBtnText, d.newBtnText]}>新建</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    gap: Spacing.sm,
  },
  headerTitle: { flex: 1, textAlign: 'center', ...Typography.h2 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  unlistedBtn: {
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  unlistedBtnText: { ...Typography.small, fontWeight: '500' },
  tabsScroll: { marginTop: Spacing.sm },
  tabsContent: { gap: Spacing.lg, paddingHorizontal: 2 },
  tab: { paddingBottom: 6, alignItems: 'center' },
  tabText: { ...Typography.bodyRegular, fontWeight: '500' },
  tabLine: { height: 2, borderRadius: 1, width: '100%', marginTop: 4 },
  statsText: {
    ...Typography.small,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    height: 40,
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  searchInput: { flex: 1, ...Typography.bodyRegular },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.lg },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm + 4,
    gap: Spacing.sm,
  },
  bottomBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: Radius.pill,
    gap: Spacing.xs,
  },
  newBtnShape: {},
  bottomBtnText: { ...Typography.body, fontWeight: '600' },
});
