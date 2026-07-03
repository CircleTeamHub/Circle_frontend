import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteCard } from '@/features/notes/components/NoteCard';
import { NoteActionsSheet } from '@/features/notes/components/NoteActionsSheet';
import { GroupManagerSheet } from '@/features/notes/components/GroupManagerSheet';
import { NoteShareQrSheet } from '@/features/notes/components/NoteShareQrSheet';
import { useNotesSettingsStore } from '@/features/notes/store/use-notes-settings-store';
import type {
  CreateNoteShareLinkInput,
  NoteGroup,
  NoteShareLink,
  NoteSummary,
} from '@/features/notes/types';
import {
  createNoteShareLink,
  deleteNote,
  fetchNoteGroups,
  fetchNotes,
  togglePinNote,
} from '@/services/api/notes';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

type TabId = 'all' | 'ungrouped' | string;

const keyExtractor = (item: NoteSummary) => item.id;

// 提到组件外并 memo：内联箭头组件每次渲染都是新类型，FlatList 无法复用分隔线。
const ItemSeparator = memo(function ItemSeparator() {
  const { colors } = useTheme();
  return <View style={[s.divider, { backgroundColor: colors.divider }]} />;
});

export default function NotesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const currentUserId = useAuthStore((state) => state.user?.id);

  const showGroups = useNotesSettingsStore((st) => st.showGroups);
  const showUngrouped = useNotesSettingsStore((st) => st.showUngrouped);
  const showSortToolbar = useNotesSettingsStore((st) => st.showSortToolbar);

  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [showUnlisted, setShowUnlisted] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // 「⋯」动作菜单针对的笔记（null = 关闭）
  const [menuNote, setMenuNote] = useState<NoteSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const [managerVisible, setManagerVisible] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [shareLink, setShareLink] = useState<NoteShareLink | null>(null);
  const [shareLinkLoading, setShareLinkLoading] = useState(false);
  const [shareLinkError, setShareLinkError] = useState<string | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    const [notesData, groupsData] = await Promise.all([
      fetchNotes({ status: showUnlisted ? 'UNLISTED' : 'ACTIVE' }),
      fetchNoteGroups(),
    ]);
    if (!mountedRef.current) return;
    setNotes(notesData);
    setGroups(groupsData);
    setLoadError(false);
    setLoading(false);
  }, [showUnlisted]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load().catch(() => {
        // 加载失败不能静默吞掉 —— 空列表和网络错误要区分开，给用户重试入口。
        if (mountedRef.current) {
          setLoadError(true);
          setLoading(false);
        }
      });
    }, [load]),
  );

  const handleRefreshNotes = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await load();
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [load]);

  const filteredNotes = useMemo(() => {
    let result = notes;
    if (activeTab === 'ungrouped') {
      result = result.filter((note) => note.groups.length === 0);
    } else if (activeTab !== 'all') {
      result = result.filter((note) =>
        note.groups.some((group) => group.id === activeTab),
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (note) =>
          note.title.toLowerCase().includes(q) ||
          (note.contentPreview ?? '').toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [notes, activeTab, search]);

  const ungroupedCount = useMemo(
    () => notes.filter((note) => note.groups.length === 0).length,
    [notes],
  );

  const tabs = useMemo(() => {
    const list: { id: TabId; label: string }[] = [
      {
        id: 'all',
        label: t('notes.tabs.all', {
          count: notes.length,
          defaultValue: `全部 ${notes.length}`,
        }),
      },
    ];
    if (showUngrouped) {
      list.push({
        id: 'ungrouped',
        label: t('notes.tabs.ungrouped', {
          count: ungroupedCount,
          defaultValue: `未分组 ${ungroupedCount}`,
        }),
      });
    }
    if (showGroups) {
      groups.forEach((group) => {
        list.push({ id: group.id, label: `${group.name} ${group.noteCount}` });
      });
    }
    return list;
  }, [groups, notes.length, showGroups, showUngrouped, t, ungroupedCount]);

  useEffect(() => {
    if (activeTab === 'ungrouped' && !showUngrouped) {
      setActiveTab('all');
      return;
    }
    if (
      !showGroups &&
      activeTab !== 'all' &&
      activeTab !== 'ungrouped' &&
      groups.some((group) => group.id === activeTab)
    ) {
      setActiveTab('all');
    }
  }, [activeTab, groups, showGroups, showUngrouped]);

  const closeManager = useCallback(() => setManagerVisible(false), []);
  const closeQrSheet = useCallback(() => setQrVisible(false), []);
  useEffect(() => {
    setShareLink(null);
    setShareLinkError(null);
  }, [activeTab, search, showUnlisted, filteredNotes]);

  const handleActiveGroupDeleted = useCallback(
    (groupId: string) => {
      if (activeTab === groupId) setActiveTab('all');
    },
    [activeTab],
  );

  const handlePin = useCallback(
    async (note: NoteSummary) => {
      try {
        await togglePinNote(note.id, !note.pinned);
      } catch {
        if (mountedRef.current) {
          Alert.alert(
            t('notes.alerts.pinFailedTitle', { defaultValue: '操作失败' }),
            t('common.retryLater', { defaultValue: '请稍后重试' }),
          );
        }
        return;
      }
      if (!mountedRef.current) return;
      setNotes((prev) =>
        prev.map((item) => (item.id === note.id ? { ...item, pinned: !item.pinned } : item)),
      );
    },
    [t],
  );

  // NoteCard 已 memo：回调保持稳定引用，搜索输入等高频重渲时卡片不再全量重绘。
  const openNote = useCallback(
    (note: NoteSummary) =>
      router.push({
        pathname: '/(tabs)/profile/notes/[id]',
        params: { id: note.id, ownerId: currentUserId ?? '' },
      } as never),
    [currentUserId, router],
  );

  const openNoteEditor = useCallback(
    (note: NoteSummary) =>
      router.push(`/(tabs)/profile/notes/edit?id=${note.id}` as never),
    [router],
  );

  const openMenu = useCallback((note: NoteSummary) => setMenuNote(note), []);
  const closeMenu = useCallback(() => setMenuNote(null), []);

  // 单条笔记分享：生成只含这条笔记的分享链接，走系统分享面板。
  const handleShareNote = useCallback(
    async (note: NoteSummary) => {
      try {
        const link = await createNoteShareLink({
          title: note.title,
          noteIds: [note.id],
        });
        if (!mountedRef.current) return;
        await Share.share({
          message: t('notes.share.message', {
            title: note.title,
            url: link.url,
            defaultValue: `${note.title}\n${link.url}`,
          }),
        });
      } catch {
        if (mountedRef.current) {
          Alert.alert(
            t('notes.share.createFailedTitle', { defaultValue: '分享链接生成失败' }),
            t('notes.share.createFailedMessage', {
              defaultValue: '无法生成分享链接，请稍后重试。',
            }),
          );
        }
      }
    },
    [t],
  );

  const handleDeleteNote = useCallback(
    (note: NoteSummary) => {
      Alert.alert(
        t('notes.alerts.deleteTitle', { defaultValue: '删除笔记' }),
        t('notes.alerts.deleteConfirm', {
          defaultValue: '确定删除这条笔记吗？删除后不可恢复。',
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('common.delete', { defaultValue: '删除' }),
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteNote(note.id);
                if (mountedRef.current) {
                  setNotes((prev) => prev.filter((item) => item.id !== note.id));
                }
              } catch {
                if (mountedRef.current) {
                  Alert.alert(
                    t('notes.alerts.deleteFailedTitle', { defaultValue: '删除失败' }),
                    t('common.retryLater', { defaultValue: '请稍后重试' }),
                  );
                }
              }
            },
          },
        ],
      );
    },
    [t],
  );

  const notesShareTitle = t('notes.share.title', { defaultValue: '我的笔记' });

  const buildShareInput = useCallback((): CreateNoteShareLinkInput => {
    const input: CreateNoteShareLinkInput = {
      title: notesShareTitle,
      status: showUnlisted ? 'UNLISTED' : 'ACTIVE',
      noteIds: filteredNotes.map((note) => note.id),
    };
    if (activeTab === 'ungrouped') {
      input.group = 'ungrouped';
    } else if (activeTab !== 'all') {
      input.groupId = activeTab;
    }
    const trimmedSearch = search.trim();
    if (trimmedSearch) input.search = trimmedSearch;
    return input;
  }, [activeTab, filteredNotes, notesShareTitle, search, showUnlisted]);

  const ensureShareLink = useCallback(async () => {
    if (shareLink) return shareLink;
    setShareLinkLoading(true);
    setShareLinkError(null);
    try {
      const nextShareLink = await createNoteShareLink(buildShareInput());
      if (mountedRef.current) setShareLink(nextShareLink);
      return nextShareLink;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('notes.share.createFailedMessage', {
              defaultValue: '无法生成分享链接，请稍后重试。',
            });
      if (mountedRef.current) setShareLinkError(message);
      throw error;
    } finally {
      if (mountedRef.current) setShareLinkLoading(false);
    }
  }, [buildShareInput, shareLink, t]);

  const handleShareNotes = useCallback(async () => {
    let nextShareLink: NoteShareLink;
    try {
      nextShareLink = await ensureShareLink();
    } catch {
      if (!mountedRef.current) return;
      Alert.alert(
        t('notes.share.createFailedTitle', { defaultValue: '分享链接生成失败' }),
        t('notes.share.createFailedMessage', {
          defaultValue: '无法生成分享链接，请稍后重试。',
        }),
      );
      return;
    }
    if (!mountedRef.current) return;
    try {
      await Share.share({
        message: t('notes.share.message', {
          title: notesShareTitle,
          url: nextShareLink.url,
          defaultValue: `${notesShareTitle}\n${nextShareLink.url}`,
        }),
      });
    } catch {
      try {
        const Clipboard = await import('expo-clipboard');
        await Clipboard.setStringAsync(nextShareLink.url);
        Alert.alert(
          t('notes.share.copiedTitle', { defaultValue: '已复制' }),
          t('notes.share.copiedMessage', {
            defaultValue: '笔记链接已复制到剪贴板。',
          }),
        );
      } catch {
        Alert.alert(
          t('notes.share.failedTitle', { defaultValue: '分享失败' }),
          t('notes.share.failedMessage', {
            defaultValue: '无法打开系统分享面板，请稍后重试。',
          }),
        );
      }
    }
  }, [ensureShareLink, notesShareTitle, t]);

  const openQrSheet = useCallback(() => {
    setQrVisible(true);
    void ensureShareLink().catch(() => undefined);
  }, [ensureShareLink]);

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
      divider: { backgroundColor: colors.divider },
      bottomBar: {
        backgroundColor: colors.background,
        borderTopColor: colors.surfaceBorder,
      },
      ghostBtn: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.surface,
      },
      newBtn: { backgroundColor: colors.primary },
      newBtnText: { color: colors.white },
      otherBtnText: { color: colors.text },
    }),
    [colors, showUnlisted],
  );

  const renderNote = useCallback(
    ({ item }: { item: NoteSummary }) => (
      <NoteCard note={item} onPress={openNote} onMorePress={openMenu} />
    ),
    [openMenu, openNote],
  );

  const statsText = t('notes.stats', {
    groupCount: groups.length,
    noteCount: notes.length,
    defaultValue: `共 ${groups.length} 个分组，合计 ${notes.length} 条笔记`,
  });

  return (
    <View style={[s.container, d.container]}>
      <View style={[s.header, d.header, { paddingTop: insets.top + 8 }]}>
        <View style={s.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={s.headerRight}>
            <Pressable
              style={[s.unlistedBtn, d.unlistedBtn]}
              onPress={() => setShowUnlisted((value) => !value)}
            >
              <Text style={[s.unlistedBtnText, d.unlistedBtnText]}>
                {t('notes.unlisted', { defaultValue: '已下架' })}
              </Text>
            </Pressable>
            {/* TODO: 接入"已删除笔记"页面（同 `已下架` toggle 的反向流程）。
               目前先弹 Alert 当 stopgap，避免静默无响应误导用户。 */}
            <Pressable
              hitSlop={8}
              onPress={() =>
                Alert.alert(
                  t('notes.stopgap.title', { defaultValue: '即将上线' }),
                  t('notes.stopgap.deletedNotes', {
                    defaultValue: '已删除笔记列表即将上线，敬请期待。',
                  }),
                )
              }
            >
              <Ionicons name="trash-outline" size={22} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              hitSlop={8}
              onPress={() =>
                router.push('/(tabs)/profile/notes/settings' as never)
              }
            >
              <Ionicons name="settings-outline" size={22} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {/* 大标题 + 统计副标题：列表页的"刊头"，其余元素都退到次级 */}
        <Text style={[s.pageTitle, d.headerTitle]}>
          {t('notes.title', { defaultValue: '我的笔记' })}
        </Text>
        <Text style={[s.statsText, d.statsText]}>{statsText}</Text>

        <View style={s.tabsRow}>
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
                  {isActive ? <View style={[s.tabLine, d.tabActiveLine]} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {showSortToolbar ? (
            <Pressable style={s.manageTab} onPress={() => setManagerVisible(true)}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <View style={[s.searchWrap, d.searchWrap]}>
          <Ionicons name="search-outline" size={16} color={d.searchPlaceholder} />
          <TextInput
            style={[s.searchInput, d.searchInput]}
            placeholder={t('notes.searchPlaceholder', {
              defaultValue: '输入你想搜索的内容',
            })}
            placeholderTextColor={d.searchPlaceholder}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      <FlatList
        data={filteredNotes}
        keyExtractor={keyExtractor}
        renderItem={renderNote}
        ItemSeparatorComponent={ItemSeparator}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
        refreshing={refreshing}
        onRefresh={handleRefreshNotes}
        ListEmptyComponent={
          loading ? null : loadError ? (
            <View style={s.emptyWrap}>
              <Text style={[s.emptyText, d.statsText]}>
                {t('notes.loadFailed', {
                  defaultValue: '笔记加载失败，请检查网络后重试',
                })}
              </Text>
              <Pressable
                style={[s.retryBtn, d.newBtn]}
                onPress={() => void handleRefreshNotes()}
              >
                <Text style={[s.bottomBtnText, d.newBtnText]}>
                  {t('common.retry', { defaultValue: '重试' })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[s.emptyText, d.statsText]}>
              {search.trim()
                ? t('notes.empty.noMatch', { defaultValue: '没有匹配的笔记' })
                : t('notes.empty.noNotes', { defaultValue: '暂无笔记' })}
            </Text>
          )
        }
      />

      <View style={[s.bottomBar, d.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable
          style={[s.bottomBtn, s.ghostBtn, d.ghostBtn]}
          onPress={() => void handleShareNotes()}
        >
          <Ionicons name="share-outline" size={18} color={colors.text} />
          <Text style={[s.bottomBtnText, d.otherBtnText]}>
            {t('notes.actions.share', { defaultValue: '分享' })}
          </Text>
        </Pressable>
        <Pressable
          style={[s.bottomBtn, s.ghostBtn, d.ghostBtn]}
          onPress={openQrSheet}
        >
          <Ionicons name="qr-code-outline" size={18} color={colors.text} />
          <Text style={[s.bottomBtnText, d.otherBtnText]}>
            {t('notes.actions.qrCode', { defaultValue: '二维码' })}
          </Text>
        </Pressable>
        <Pressable
          style={[s.bottomBtn, d.newBtn]}
          onPress={() => router.push('/(tabs)/profile/notes/edit' as never)}
        >
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={[s.bottomBtnText, d.newBtnText]}>
            {t('notes.actions.new', { defaultValue: '新建' })}
          </Text>
        </Pressable>
      </View>

      <GroupManagerSheet
        visible={managerVisible}
        onClose={closeManager}
        groups={groups}
        setGroups={setGroups}
        notes={notes}
        onMembershipsChanged={load}
        onActiveGroupDeleted={handleActiveGroupDeleted}
      />
      <NoteShareQrSheet
        visible={qrVisible}
        title={notesShareTitle}
        shareUrl={shareLink?.url ?? ''}
        noteCount={filteredNotes.length}
        loading={shareLinkLoading}
        errorMessage={shareLinkError}
        onClose={closeQrSheet}
      />
      <NoteActionsSheet
        note={menuNote}
        onClose={closeMenu}
        onPin={handlePin}
        onEdit={openNoteEditor}
        onShare={handleShareNote}
        onDelete={handleDeleteNote}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  pageTitle: { ...Typography.h1, marginTop: Spacing.xs },
  unlistedBtn: {
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  unlistedBtnText: { ...Typography.small, fontWeight: '500' },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: Spacing.md,
  },
  tabsScroll: { flex: 1 },
  tabsContent: { gap: Spacing.lg, paddingHorizontal: 2, alignItems: 'flex-end' },
  tab: { paddingBottom: 6, alignItems: 'center' },
  manageTab: {
    width: 40,
    paddingBottom: 6,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  tabText: { ...Typography.bodyRegular, fontWeight: '500' },
  tabLine: { height: 2, borderRadius: 1, width: '100%', marginTop: 4 },
  statsText: {
    ...Typography.small,
    marginTop: Spacing.xs,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    height: 44,
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  searchInput: { flex: 1, ...Typography.bodyRegular },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.lg },
  emptyWrap: { alignItems: 'center', gap: Spacing.md },
  emptyText: {
    textAlign: 'center',
    paddingTop: Spacing.xl,
    ...Typography.bodyRegular,
  },
  retryBtn: {
    paddingHorizontal: Spacing.lg,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm + 4,
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
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
  ghostBtn: { borderWidth: 1 },
  bottomBtnText: { ...Typography.body, fontWeight: '600' },
});
