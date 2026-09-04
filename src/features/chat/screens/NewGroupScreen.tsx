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
import { useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { createGroupConversation } from '@/chat-core/client';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { reportHandledFailure } from '@/observability/report-failure';

/** 服务端 CreateGroupConversationDto 的同款下限:除自己外至少 2 位好友。 */
const MIN_MEMBERS = 2;

const s = StyleSheet.create({
  container: { flex: 1 },
  nameWrap: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: Radius.md,
    justifyContent: 'center',
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
  const segments = useSegments();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchFriends();
        if (!cancelled) setFriends(list);
      } catch (error) {
        reportHandledFailure('group', 'loadFriends', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleFriends = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return friends;
    return friends.filter((friend) =>
      `${friend.remark ?? ''} ${friend.nickname} ${friend.accountId}`
        .toLowerCase()
        .includes(keyword),
    );
  }, [friends, query]);

  const selectedCount = Object.keys(selected).length;
  const canSubmit = selectedCount >= MIN_MEMBERS && !submitting;

  const toggle = useCallback((friendId: string) => {
    setSelected((prev) => {
      if (prev[friendId]) {
        const next = { ...prev };
        delete next[friendId];
        return next;
      }
      return { ...prev, [friendId]: true };
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    if (selectedCount < MIN_MEMBERS) {
      Alert.alert(t('messages.newGroupMinMembers'));
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const { conversationID } = await createGroupConversation({
        name: name.trim() || null,
        memberIds: Object.keys(selected),
      });
      if (!mountedRef.current) return;
      const inDiscoverStack = (segments as readonly string[]).includes(
        'discover',
      );
      // 建完直接进群聊页;replace 掉建群页,返回时回到消息列表而不是选人页。
      router.replace({
        pathname: inDiscoverStack
          ? '/(tabs)/discover/chat-detail'
          : '/(tabs)/messages/chat-detail',
        params: {
          conversationID,
          sourceID: conversationID,
          title: name.trim() || t('messages.newGroupDefaultName'),
          conversationType: 'group',
          conversationKind: 'group',
        },
      });
    } catch (error) {
      // 只有失败才解锁。成功路径已经 router.replace 走了，但屏幕要到下一帧之后
      // 才真正卸载；把解锁放在 finally 里等于在这段转场窗口里又把按钮放开，而
      // 建群在服务端没有幂等 —— 慢设备上再点一下就会建出第二个成员完全相同的群。
      submittingRef.current = false;
      if (mountedRef.current) {
        setSubmitting(false);
        Alert.alert(
          t('messages.newGroupCreateFailed', {
            error: getApiErrorMessage(error, t('common.networkError')),
          }),
        );
      }
    }
  }, [name, router, segments, selected, selectedCount, t]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FriendProfile>) => {
      const checked = Boolean(selected[item.id]);
      const displayName = item.remark?.trim() || item.nickname;
      return (
        <Pressable
          style={[s.row, { backgroundColor: colors.surface }]}
          onPress={() => toggle(item.id)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={displayName}
        >
          <Ionicons
            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={checked ? colors.primary : colors.textSecondary}
          />
          <Avatar name={displayName} uri={item.avatarUrl ?? undefined} size={40} />
          <View style={s.rowText}>
            <Text style={{ color: colors.text, ...Typography.body }} numberOfLines={1}>
              {displayName}
            </Text>
          </View>
        </Pressable>
      );
    },
    [colors, selected, toggle],
  );

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <NavHeader title={t('messages.newGroupTitle')} fallbackHref="/(tabs)/messages" />

      <View style={[s.nameWrap, { backgroundColor: colors.surface }]}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('messages.newGroupNamePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          style={{ color: colors.text, ...Typography.body }}
          maxLength={30}
        />
      </View>

      <View style={[s.searchWrap, { backgroundColor: colors.surface }]}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('messages.newGroupSearchPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          style={[s.searchInput, { color: colors.text, ...Typography.body }]}
        />
      </View>

      <Text
        style={{
          color: colors.textSecondary,
          ...Typography.caption,
          ...s.sectionLabel,
        }}
      >
        {t('messages.newGroupSelectMembers')}
      </Text>

      {loading ? (
        <View style={s.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={visibleFriends}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={s.listContent}
          {...keyboardDismissOnDragProps}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={{ color: colors.textSecondary, ...Typography.body }}>
                {t(
                  friends.length === 0
                    ? 'messages.newGroupNoFriends'
                    : 'messages.newGroupNoMatches',
                )}
              </Text>
            </View>
          }
        />
      )}

      <View
        style={[
          s.footer,
          {
            borderTopColor: colors.surfaceBorder,
            paddingBottom: Math.max(insets.bottom, Spacing.md),
            backgroundColor: colors.background,
          },
        ]}
      >
        <Pressable
          style={[
            s.submitButton,
            {
              backgroundColor: canSubmit ? colors.primary : colors.surfaceBorder,
            },
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={t('messages.newGroupSubmit')}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={{ color: colors.white, ...Typography.body, fontWeight: '600' }}>
              {selectedCount > 0
                ? `${t('messages.newGroupSubmit')} · ${t('messages.newGroupSelectedCount', { count: selectedCount })}`
                : t('messages.newGroupSubmit')}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
