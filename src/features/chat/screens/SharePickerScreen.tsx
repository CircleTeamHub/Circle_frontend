import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { useSharePickerStore } from '@/features/chat/store/use-share-picker-store';
import { canResendCollection } from '@/features/chat/utils/message-collection';
import {
  MAX_NOTE_BATCH_SELECTION,
  hasAnyNoteSendOption,
  isAllNoteSendOptions,
  withAllNoteSendOptions,
  type NoteSendOptions,
} from '@/features/chat/utils/note-batch-send';
import { NoteCard } from '@/features/notes/components/NoteCard';
import type { NoteSummary } from '@/features/notes/types';
import { fetchCollections, type UserCollection } from '@/services/api/collections';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { fetchNotes } from '@/services/api/notes';
import i18n from '@/i18n';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

type ShareType = 'note' | 'friend' | 'favorite' | 'quick-reply';

// i18n.t(..., { defaultValue }) — 现有中文用作 fallback，加 key 后会自动切英文。
function shareTitle(type: ShareType): string {
  switch (type) {
    case 'note':
      return i18n.t('share.title.note', { defaultValue: '选择笔记' });
    case 'friend':
      return i18n.t('share.title.friend', { defaultValue: '选择好友名片' });
    case 'favorite':
      return i18n.t('share.title.favorite', { defaultValue: '选择收藏' });
    case 'quick-reply':
      return i18n.t('share.title.quickReply', { defaultValue: '快捷语' });
  }
}

const QUICK_REPLY_DEFAULTS: readonly string[] = [
  '在的，你说',
  '好的，没问题',
  '收到，稍等一下',
  '抱歉刚才没看到消息',
  '今天有点忙，晚点回复',
  '哈哈，太有意思了',
];

function getQuickReplyPhrases(): readonly string[] {
  return QUICK_REPLY_DEFAULTS.map((phrase, index) =>
    i18n.t(`share.quickReply.${index}`, { defaultValue: phrase }),
  );
}

export default function SharePickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { type } = useLocalSearchParams<{ type?: ShareType }>();
  const shareType: ShareType = (type as ShareType) ?? 'note';
  const setPending = useSharePickerStore((s) => s.setPending);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [favorites, setFavorites] = useState<UserCollection[]>([]);
  const [reloadVersion, setReloadVersion] = useState(0);
  // 笔记走多选:先勾笔记,再在底部 sheet 里勾「发什么」(默认只发卡片)。
  const [selectedNotes, setSelectedNotes] = useState<NoteSummary[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sendOptions, setSendOptions] = useState<NoteSendOptions>({
    card: true,
    media: false,
    showcase: false,
    location: false,
  });
  const headerTitle = shareTitle(shareType);
  // Memoized：i18n.t 已可缓存，但本地包一层让消费方在 useMemo deps 里能稳定引用。
  const quickReplyPhrases = useMemo(() => getQuickReplyPhrases(), []);

  useEffect(() => {
    if (shareType === 'quick-reply') {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (shareType === 'note') {
          const res = await fetchNotes();
          if (!cancelled) setNotes(res);
        } else if (shareType === 'friend') {
          const res = await fetchFriends();
          if (!cancelled) setFriends(res);
        } else if (shareType === 'favorite') {
          const res = await fetchCollections();
          // NOTE 收藏已迁到「我的笔记」（发笔记走「笔记」入口），这里不再展示遗留数据。
          if (!cancelled) setFavorites(res.filter((c) => c.type !== 'NOTE'));
        }
      } catch (err) {
        if (!cancelled) {
          // 不再只 dev-warn —— 暴露给用户 + 提供重试，"加载失败"和"真的空"区分开。
          setError(
            err instanceof Error
              ? err.message
              : i18n.t('share.loadFailed', { defaultValue: '加载失败' }),
          );
        }
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn(`[share-picker] fetch ${shareType} failed`, err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shareType, reloadVersion]);

  const trimmed = query.trim().toLowerCase();

  const filteredNotes = useMemo(() => {
    if (!trimmed) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(trimmed) ||
        (n.contentPreview ?? '').toLowerCase().includes(trimmed),
    );
  }, [notes, trimmed]);

  const filteredFriends = useMemo(() => {
    if (!trimmed) return friends;
    return friends.filter(
      (f) =>
        f.nickname.toLowerCase().includes(trimmed) ||
        f.accountId.toLowerCase().includes(trimmed),
    );
  }, [friends, trimmed]);

  const filteredFavorites = useMemo(() => {
    if (!trimmed) return favorites;
    return favorites.filter(
      (c) =>
        c.title.toLowerCase().includes(trimmed) ||
        (c.summary ?? '').toLowerCase().includes(trimmed),
    );
  }, [favorites, trimmed]);

  const filteredQuickReply = useMemo(() => {
    if (!trimmed) return quickReplyPhrases;
    return quickReplyPhrases.filter((p) =>
      p.toLowerCase().includes(trimmed),
    );
  }, [quickReplyPhrases, trimmed]);

  const handleSelect = useCallback(
    (item: FriendProfile | UserCollection | string) => {
      if (shareType === 'friend') {
        setPending({ kind: 'friend', data: item as FriendProfile });
      } else if (shareType === 'favorite') {
        setPending({ kind: 'favorite', data: item as UserCollection });
      } else {
        setPending({ kind: 'quick-reply', data: item as string });
      }
      router.back();
    },
    [router, setPending, shareType],
  );

  const toggleNote = useCallback((note: NoteSummary) => {
    setSelectedNotes((prev) => {
      if (prev.some((n) => n.id === note.id)) {
        return prev.filter((n) => n.id !== note.id);
      }
      if (prev.length >= MAX_NOTE_BATCH_SELECTION) return prev;
      return [...prev, note];
    });
  }, []);

  const atSelectionLimit = selectedNotes.length >= MAX_NOTE_BATCH_SELECTION;

  const handleConfirmSend = useCallback(() => {
    if (selectedNotes.length === 0 || !hasAnyNoteSendOption(sendOptions)) {
      return;
    }
    setPending({
      kind: 'note-batch',
      notes: selectedNotes,
      options: sendOptions,
    });
    setOptionsOpen(false);
    router.back();
  }, [router, selectedNotes, sendOptions, setPending]);

  // 多选态复用 NoteCard 自带的 selectionMode(勾选指示/无障碍状态都在卡片里),
  // 不再另裹一层手搓 checkbox —— 与笔记列表的多选视觉保持同一来源。
  const renderNote = ({ item }: { item: NoteSummary }) => (
    <NoteCard
      note={item}
      onPress={toggleNote}
      showActions={false}
      selectionMode
      selected={selectedNotes.some((n) => n.id === item.id)}
    />
  );

  const renderFriend = ({ item }: { item: FriendProfile }) => (
    <Pressable
      style={[s.row, { backgroundColor: colors.surface }]}
      onPress={() => handleSelect(item)}
    >
      <Avatar
        size={40}
        shape="square"
        name={item.nickname}
        uri={item.avatarUrl ?? undefined}
      />
      <View style={s.rowText}>
        <Text style={[s.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {item.nickname}
        </Text>
        <Text
          style={[s.rowSubtitle, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {item.accountId}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );

  /**
   * 旧版语音收藏(OpenIM 时代只存了会过期的播放地址,推不回 object key)
   * 永远发不出去。先把入口亮出来、点了再报一句「发送失败,请重试」是最坏的
   * 组合 —— 用户会一直重试。这里直接禁用该行并写明原因。
   */
  const renderFavorite = ({ item }: { item: UserCollection }) => {
    const resendable = canResendCollection(item);
    const subtitle = resendable
      ? item.summary
      : i18n.t('share.favoriteLegacyVoiceUnsupported', {
          defaultValue: '旧版语音收藏，无法重新发送',
        });
    return (
      <Pressable
        style={[
          s.row,
          { backgroundColor: colors.surface },
          resendable ? null : s.rowDisabled,
        ]}
        disabled={!resendable}
        onPress={() => handleSelect(item)}
      >
        <View style={s.rowText}>
          <Text style={[s.rowTitle, { color: colors.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          {subtitle ? (
            <Text
              style={[s.rowSubtitle, { color: colors.textSecondary }]}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {resendable ? (
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        ) : null}
      </Pressable>
    );
  };

  const renderQuickReply = ({ item }: { item: string }) => (
    <Pressable
      style={[s.row, { backgroundColor: colors.surface }]}
      onPress={() => handleSelect(item)}
    >
      <Text style={[s.rowTitle, { color: colors.text }]}>{item}</Text>
    </Pressable>
  );

  const empty = !loading && (
    shareType === 'note' ? filteredNotes.length === 0
    : shareType === 'friend' ? filteredFriends.length === 0
    : shareType === 'favorite' ? filteredFavorites.length === 0
    : filteredQuickReply.length === 0
  );

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={s.header}>
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.text }]}>
          {headerTitle}
        </Text>
        <View style={s.headerSpacer} />
      </View>

      <View style={[s.searchWrap, { backgroundColor: colors.surface }]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, { color: colors.text }]}
          placeholder={i18n.t('common.search', { defaultValue: '搜索' })}
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query ? (
          <Pressable hitSlop={8} onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={{ color: colors.error, ...Typography.bodyRegular }}>
            {error}
          </Text>
          <Pressable
            onPress={() => setReloadVersion((v) => v + 1)}
            style={{
              marginTop: Spacing.md,
              paddingHorizontal: Spacing.lg,
              paddingVertical: Spacing.sm,
              borderRadius: Radius.md,
              backgroundColor: colors.primary,
            }}
          >
            <Text style={{ color: colors.white, ...Typography.body }}>
              {i18n.t('common.retry', { defaultValue: '重试' })}
            </Text>
          </Pressable>
        </View>
      ) : empty ? (
        <View style={s.center}>
          <Text style={{ color: colors.textSecondary, ...Typography.bodyRegular }}>
            {query
              ? i18n.t('share.noMatch', { defaultValue: '没有匹配项' })
              : i18n.t('share.empty', { defaultValue: '暂无内容' })}
          </Text>
        </View>
      ) : shareType === 'note' ? (
        <FlatList
          data={filteredNotes}
          keyExtractor={(it) => it.id}
          renderItem={renderNote}
          extraData={selectedNotes}
          ItemSeparatorComponent={() => (
            <View style={[s.divider, { backgroundColor: colors.surface }]} />
          )}
          contentContainerStyle={[
            s.noteListContent,
            selectedNotes.length > 0 ? s.noteListContentWithBar : null,
          ]}
        {...keyboardDismissOnDragProps}
          showsVerticalScrollIndicator={false}
        />
      ) : shareType === 'friend' ? (
        <FlatList
          data={filteredFriends}
          keyExtractor={(it) => it.id}
          renderItem={renderFriend}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
        {...keyboardDismissOnDragProps}
        />
      ) : shareType === 'favorite' ? (
        <FlatList
          data={filteredFavorites}
          keyExtractor={(it) => it.id}
          renderItem={renderFavorite}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
        {...keyboardDismissOnDragProps}
        />
      ) : (
        <FlatList
          data={filteredQuickReply}
          keyExtractor={(it) => it}
          renderItem={renderQuickReply}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
        {...keyboardDismissOnDragProps}
        />
      )}

      {shareType === 'note' && selectedNotes.length > 0 ? (
        <View
          style={[
            s.noteBar,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.surfaceBorder,
              paddingBottom: insets.bottom + Spacing.sm,
            },
          ]}
        >
          {atSelectionLimit ? (
            <Text style={[s.noteBarHint, { color: colors.textSecondary }]}>
              {i18n.t('share.noteBatch.limitHint', {
                defaultValue: '最多选择 {{count}} 条笔记',
                count: MAX_NOTE_BATCH_SELECTION,
              })}
            </Text>
          ) : null}
          <Pressable
            style={[s.noteSendButton, { backgroundColor: colors.primary }]}
            onPress={() => setOptionsOpen(true)}
            accessibilityRole="button"
          >
            <Text style={[s.noteSendButtonText, { color: colors.white }]}>
              {i18n.t('share.noteBatch.next', {
                defaultValue: '发送 ({{count}})',
                count: selectedNotes.length,
              })}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <BottomSheetModal
        visible={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        backdropStyle={{ backgroundColor: colors.overlay }}
        sheetStyle={[
          s.sheet,
          {
            backgroundColor: colors.surface,
            paddingBottom: insets.bottom + Spacing.lg,
          },
        ]}
      >
        <View style={[s.sheetHandle, { backgroundColor: colors.surfaceBorder }]} />
        <Text style={[s.sheetTitle, { color: colors.textSecondary }]}>
          {i18n.t('share.noteBatch.optionsTitle', {
            defaultValue: '发送 {{count}} 条笔记',
            count: selectedNotes.length,
          })}
        </Text>

        {(
          [
            { key: 'card' as const, labelKey: 'share.noteBatch.optionCard', defaultLabel: '发送笔记' },
            { key: 'media' as const, labelKey: 'share.noteBatch.optionMedia', defaultLabel: '发送笔记的图片+视频' },
            { key: 'showcase' as const, labelKey: 'share.noteBatch.optionShowcase', defaultLabel: '发送展示' },
            { key: 'location' as const, labelKey: 'share.noteBatch.optionLocation', defaultLabel: '发送地址' },
          ]
        ).map((row) => {
          const checked = sendOptions[row.key];
          return (
            <Pressable
              key={row.key}
              style={s.optionRow}
              onPress={() =>
                setSendOptions((prev) => ({ ...prev, [row.key]: !prev[row.key] }))
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
            >
              <Text style={[s.optionLabel, { color: colors.text }]}>
                {i18n.t(row.labelKey, { defaultValue: row.defaultLabel })}
              </Text>
              <Ionicons
                name={checked ? 'checkbox' : 'square-outline'}
                size={22}
                color={checked ? colors.primary : colors.textSecondary}
              />
            </Pressable>
          );
        })}

        <View style={[s.optionDivider, { backgroundColor: colors.divider }]} />

        <Pressable
          style={s.optionRow}
          onPress={() =>
            setSendOptions((prev) =>
              withAllNoteSendOptions(prev, !isAllNoteSendOptions(prev)),
            )
          }
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isAllNoteSendOptions(sendOptions) }}
        >
          <Text style={[s.optionLabel, s.optionLabelStrong, { color: colors.text }]}>
            {i18n.t('share.noteBatch.optionAll', { defaultValue: '全部发送' })}
          </Text>
          <Ionicons
            name={isAllNoteSendOptions(sendOptions) ? 'checkbox' : 'square-outline'}
            size={22}
            color={
              isAllNoteSendOptions(sendOptions)
                ? colors.primary
                : colors.textSecondary
            }
          />
        </Pressable>

        <Pressable
          style={[
            s.noteSendButton,
            s.sheetConfirm,
            {
              backgroundColor: hasAnyNoteSendOption(sendOptions)
                ? colors.primary
                : colors.surfaceBorder,
            },
          ]}
          disabled={!hasAnyNoteSendOption(sendOptions)}
          onPress={handleConfirmSend}
          accessibilityRole="button"
        >
          <Text style={[s.noteSendButtonText, { color: colors.white }]}>
            {i18n.t('share.noteBatch.confirm', { defaultValue: '发送' })}
          </Text>
        </Pressable>
      </BottomSheetModal>
    </View>
  );
}

function Sep() {
  return <View style={{ height: Spacing.sm }} />;
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    height: 48,
  },
  headerTitle: { ...Typography.h3, fontWeight: '700' },
  headerSpacer: { width: 24 },
  searchWrap: {
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    minHeight: 52,
    borderRadius: Radius.md,
  },
  searchInput: {
    flex: 1,
    ...Typography.bodyRegular,
    lineHeight: 20,
    minHeight: 24,
    paddingVertical: 0,
  },
  noteListContent: {
    paddingBottom: Spacing.xl,
  },
  // 底栏最高态(上限提示行 + 34pt 刘海 inset)约 117pt,再留出大字号无障碍余量。
  noteListContentWithBar: {
    paddingBottom: 136,
  },
  noteBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  noteBarHint: {
    ...Typography.small,
    textAlign: 'center',
  },
  noteSendButton: {
    minHeight: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteSendButtonText: {
    ...Typography.body,
    fontWeight: '600',
  },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  sheetTitle: {
    ...Typography.small,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  optionRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  optionLabel: {
    ...Typography.body,
  },
  optionLabelStrong: {
    fontWeight: '600',
  },
  optionDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.xs,
  },
  sheetConfirm: {
    marginTop: Spacing.md,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: Spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  rowDisabled: { opacity: 0.45 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...Typography.body, fontWeight: '600' },
  rowSubtitle: { ...Typography.small, lineHeight: 18 },
  divider: {
    height: 1,
    marginLeft: Spacing.lg,
  },
});
