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
import { getApiErrorMessage } from '@/services/api/errors';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { fetchNotes } from '@/services/api/notes';
import i18n from '@/i18n';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
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

// 底栏常驻的「发什么」开关(横排 icon+短标签)。「全部」是四项的派生开关,单独渲染。
// accent 取自色板 token:每项一个色相,选中时同色淡底+同色描边+同色图标文字,
// 未选中保持中性灰 —— 让"选了什么"一眼可辨,而不是五个一样的灰框。
const NOTE_OPTION_CHIPS = [
  {
    key: 'card',
    icon: 'document-text-outline',
    accent: 'primary',
    labelKey: 'share.noteBatch.optionCard',
    defaultLabel: '笔记',
  },
  {
    key: 'media',
    icon: 'images-outline',
    accent: 'blue',
    labelKey: 'share.noteBatch.optionMedia',
    defaultLabel: '图片视频',
  },
  {
    key: 'showcase',
    icon: 'sparkles-outline',
    accent: 'orange',
    labelKey: 'share.noteBatch.optionShowcase',
    defaultLabel: '展示',
  },
  {
    key: 'location',
    icon: 'location-outline',
    accent: 'success',
    labelKey: 'share.noteBatch.optionLocation',
    defaultLabel: '地址',
  },
] as const;

/** 「全部」是四项的派生开关，用品牌紫与单项色相区隔。 */
const NOTE_OPTION_ALL_ACCENT = 'brandPurple' as const;

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

interface NoteOptionChipProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** 该项的品牌色（取自色板 token）：选中态的底/边/字/对号都用它 */
  accent: string;
  checked: boolean;
  onToggle: () => void;
}

/** 底栏「发什么」单个开关：图标 + 标签 + 对号。四个分区与「全部」共用。 */
function NoteOptionChip({
  icon,
  label,
  accent,
  checked,
  onToggle,
}: NoteOptionChipProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      style={[
        s.optionChip,
        {
          borderColor: checked ? accent : colors.surfaceBorder,
          backgroundColor: checked ? withAlpha(accent, 0.12) : colors.background,
        },
      ]}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <Ionicons
        name={icon}
        size={20}
        color={checked ? accent : colors.textSecondary}
      />
      <Text
        style={[
          s.optionChipLabel,
          checked ? s.optionChipLabelOn : null,
          { color: checked ? accent : colors.textSecondary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {/* 对号常驻占位：选中实心、未选空心，两态等高，切换时行高不跳。
          只靠配色区分选中对色觉障碍用户不友好，这里补一个形状信号。 */}
      <Ionicons
        name={checked ? 'checkmark-circle' : 'ellipse-outline'}
        size={15}
        color={checked ? accent : colors.surfaceBorder}
      />
    </Pressable>
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
  // 笔记走多选:「发什么」是底栏常驻的一行横排开关(默认只发卡片),
  // 点「发送」直接按当前勾选发 —— 不再经过确认 sheet。
  const [selectedNotes, setSelectedNotes] = useState<NoteSummary[]>([]);
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
            getApiErrorMessage(
              err,
              i18n.t('share.loadFailed', { defaultValue: '加载失败' }),
            ),
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
              borderTopColor: colors.divider,
              shadowColor: colors.black,
              paddingBottom: insets.bottom + Spacing.sm,
            },
          ]}
        >
          {atSelectionLimit ? (
            <Text style={[s.noteBarHint, { color: colors.warning }]}>
              {i18n.t('share.noteBatch.limitHint', {
                defaultValue: '最多选择 {{count}} 条笔记',
                count: MAX_NOTE_BATCH_SELECTION,
              })}
            </Text>
          ) : null}
          <View style={s.optionChipsRow}>
            {NOTE_OPTION_CHIPS.map((chip) => (
              <NoteOptionChip
                key={chip.key}
                icon={chip.icon}
                label={i18n.t(chip.labelKey, { defaultValue: chip.defaultLabel })}
                accent={colors[chip.accent]}
                checked={sendOptions[chip.key]}
                onToggle={() =>
                  setSendOptions((prev) => ({
                    ...prev,
                    [chip.key]: !prev[chip.key],
                  }))
                }
              />
            ))}
            <NoteOptionChip
              icon="checkmark-done-outline"
              label={i18n.t('share.noteBatch.optionAll', { defaultValue: '全部' })}
              accent={colors[NOTE_OPTION_ALL_ACCENT]}
              checked={isAllNoteSendOptions(sendOptions)}
              onToggle={() =>
                setSendOptions((prev) =>
                  withAllNoteSendOptions(prev, !isAllNoteSendOptions(prev)),
                )
              }
            />
          </View>
          <Pressable
            style={[
              s.noteSendButton,
              hasAnyNoteSendOption(sendOptions)
                ? [s.noteSendButtonOn, { shadowColor: colors.primary }]
                : null,
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
            <Ionicons
              name="paper-plane"
              size={17}
              color={
                hasAnyNoteSendOption(sendOptions)
                  ? colors.white
                  : colors.textSecondary
              }
            />
            <Text
              style={[
                s.noteSendButtonText,
                {
                  color: hasAnyNoteSendOption(sendOptions)
                    ? colors.white
                    : colors.textSecondary,
                },
              ]}
            >
              {i18n.t('share.noteBatch.next', {
                defaultValue: '发送 ({{count}})',
                count: selectedNotes.length,
              })}
            </Text>
          </Pressable>
        </View>
      ) : null}
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
  // 底栏最高态(上限提示行 + 常驻选项行 + 发送键 + 34pt 刘海 inset)约 175pt,
  // 再留出大字号无障碍余量。
  noteListContentWithBar: {
    paddingBottom: 226,
  },
  noteBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
    // 底栏浮在列表之上：上缘投影替代硬分割线的重量感。
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  noteBarHint: {
    ...Typography.small,
    fontWeight: '500',
    textAlign: 'center',
  },
  noteSendButton: {
    flexDirection: 'row',
    minHeight: 50,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs + 2,
  },
  // 可发送时给主按钮一层同色辉光，和置灰态拉开层次。
  noteSendButtonOn: {
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  noteSendButtonText: {
    ...Typography.body,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  optionChipsRow: {
    flexDirection: 'row',
    gap: Spacing.sm - 2,
  },
  optionChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: 2,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
  },
  optionChipLabel: {
    ...Typography.tinyRegular,
    fontWeight: '500',
  },
  optionChipLabelOn: {
    fontWeight: '700',
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
