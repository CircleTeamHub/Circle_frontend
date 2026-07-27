import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
import { NavHeader } from '@/components/ui/nav-header';
import {
  createGroupChat,
  getOrCreateGroupConversation,
  toImUserId,
} from '@/im/client';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  inputCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  groupNameInput: {
    height: 44,
    padding: 0,
  },
  searchWrap: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderRadius: Radius.md,
  },
  searchInput: { flex: 1, padding: 0 },
  sectionLabel: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  rowText: { flex: 1, gap: 2 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.xxl,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitButton: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const Sep = () => <View style={{ height: Spacing.xs }} />;

export default function NewGroupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [groupName, setGroupName] = useState('');
  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [submitting, setSubmitting] = useState(false);
  // Pattern D 第二道：createGroupChat 是后端写操作，fast double-tap 可能创出两个群。
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFriends()
      .then((list) => {
        if (!cancelled) setFriends(list);
      })
      .catch((err) => {
        if (!cancelled) setFriends([]);
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[new-group] fetchFriends failed', err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedQuery = query.trim().toLowerCase();
  const filteredFriends = useMemo(() => {
    if (!trimmedQuery) return friends;
    return friends.filter(
      (friend) =>
        friend.nickname.toLowerCase().includes(trimmedQuery) ||
        friend.accountId.toLowerCase().includes(trimmedQuery),
    );
  }, [friends, trimmedQuery]);

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);
  const selectedCount = selectedIds.length;

  const toggleFriend = useCallback((id: string) => {
    setSelected((current) => {
      if (current[id]) {
        const { [id]: _, ...rest } = current;
        return rest;
      }
      return { ...current, [id]: true };
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting || inFlightRef.current) return;
    // 新建群至少选 2 位好友（创建者 + 2 = 3 人群）—— 跟 iMessage 一致，避免
    // "1 个好友 = 2 人群"在 UX 上与私聊难区分；想要 1 对 1 直接走单聊。
    if (selectedCount < 2) {
      Alert.alert(t('messages.newGroupMinMembers'));
      return;
    }

    const memberUserIDs = selectedIds.map(toImUserId);
    const selectedFriends = friends.filter((friend) => selected[friend.id]);
    const trimmedName = groupName.trim();
    const fallbackName =
      selectedFriends
        .slice(0, 3)
        .map((friend) => friend.nickname)
        .join('、') || t('messages.newGroupDefaultName');
    const finalName = trimmedName || fallbackName;

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const group = await createGroupChat({
        groupName: finalName,
        memberUserIDs,
      });
      const conversation = await getOrCreateGroupConversation(group.groupID);

      router.replace({
        pathname: '/(tabs)/messages/chat-detail',
        params: {
          conversationID: conversation.conversationID,
          sourceID: group.groupID,
          title: group.groupName || finalName,
          conversationType: 'group',
          avatarUrl: group.faceURL ?? '',
        },
      });
    } catch (error) {
      Alert.alert(
        t('messages.newGroupCreateFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [
    friends,
    groupName,
    router,
    selected,
    selectedCount,
    selectedIds,
    submitting,
    t,
  ]);

  const d = useMemo(
    () => ({
      container: {
        backgroundColor: colors.background,
      },
      surface: {
        backgroundColor: colors.surface,
      },
      surfaceBorder: {
        borderColor: colors.surfaceBorder,
      },
      input: {
        color: colors.text,
        ...Typography.bodyRegular,
      },
      label: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      rowName: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      rowSubtitle: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      submitText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FriendProfile>) => {
      const checked = Boolean(selected[item.id]);
      return (
        <Pressable
          style={[s.row, d.surface]}
          onPress={() => toggleFriend(item.id)}
        >
          <Avatar
            size={40}
            shape="square"
            name={item.nickname}
            uri={item.avatarUrl ?? undefined}
          />
          <View style={s.rowText}>
            <MemberName
              name={item.nickname}
              userId={item.id}
              style={d.rowName}
              numberOfLines={1}
            />
            <Text style={d.rowSubtitle} numberOfLines={1}>
              {item.accountId}
            </Text>
          </View>
          <Ionicons
            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={checked ? colors.primary : colors.textSecondary}
          />
        </Pressable>
      );
    },
    [colors.primary, colors.textSecondary, d.rowName, d.rowSubtitle, d.surface, selected, toggleFriend],
  );

  const submitDisabled = submitting || selectedCount < 1;

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('messages.newGroupTitle')} />

      <View style={[s.inputCard, d.surface]}>
        <TextInput
          style={[s.groupNameInput, d.input]}
          placeholder={t('messages.newGroupNamePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          value={groupName}
          onChangeText={setGroupName}
          maxLength={30}
        />
      </View>

      <View style={[s.searchWrap, d.surface]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, d.input]}
          placeholder={t('messages.newGroupSearchPlaceholder')}
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

      <Text style={[s.sectionLabel, d.label]}>
        {t('messages.newGroupSelectMembers')}
        {selectedCount > 0
          ? ` · ${t('messages.newGroupSelectedCount', { count: selectedCount })}`
          : ''}
      </Text>

      {loading ? (
        <View style={s.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : filteredFriends.length === 0 ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>
            {trimmedQuery
              ? t('messages.newGroupNoMatches')
              : t('messages.newGroupNoFriends')}
          </Text>
        </View>
      ) : (
        <FlatList
          style={s.scroll}
          data={filteredFriends}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
        {...keyboardDismissOnDragProps}
        />
      )}

      <View
        style={[
          s.footer,
          d.surfaceBorder,
          { paddingBottom: Math.max(insets.bottom, Spacing.md) },
        ]}
      >
        <Pressable
          style={[
            s.submitButton,
            {
              backgroundColor: submitDisabled ? colors.surface : colors.primary,
              opacity: submitDisabled ? 0.6 : 1,
            },
          ]}
          onPress={submitDisabled ? undefined : handleSubmit}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={d.submitText}>
              {selectedCount > 0
                ? `${t('messages.newGroupSubmit')} (${selectedCount})`
                : t('messages.newGroupSubmit')}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
