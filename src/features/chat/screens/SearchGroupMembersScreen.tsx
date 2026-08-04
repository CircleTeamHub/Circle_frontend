import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GroupMemberItem } from '@openim/rn-client-sdk';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { fromImUserId, loadGroupMemberList } from '@/im/client';
import { useGroupMemberViewAccess } from '@/features/chat/hooks/use-group-member-view-access';
import {
  getUserProfileHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { useIMStore } from '@/stores/imStore';

const s = StyleSheet.create({
  container: { flex: 1 },
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
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
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
});

const Sep = () => <View style={{ height: Spacing.xs }} />;

export default function SearchGroupMembersScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const params = useLocalSearchParams<{
    groupID?: string;
    groupTitle?: string;
  }>();
  const groupID = typeof params.groupID === 'string' ? params.groupID : '';
  const currentUserID = useIMStore((state) => state.currentUserID);
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<GroupMemberItem[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // review R2 P1：权限走活体 hook——挂载期间被撤权时订阅立即翻转
  // authorized，下面的目录数据也同步清空，不再是一次性快照。
  const {
    canViewMembers: authorized,
    resolved: accessResolved,
    revalidate,
  } = useGroupMemberViewAccess({
    enabled: Boolean(groupID && currentUserID),
    groupID,
    currentUserID,
  });

  useEffect(() => {
    let cancelled = false;
    if (!authorized) {
      setMembers([]);
      setMembersLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setMembersLoading(true);
    loadGroupMemberList(groupID, 10_000)
      .then((nextMembers) => {
        if (!cancelled) setMembers(nextMembers);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authorized, groupID]);

  const loading = !accessResolved || membersLoading;

  const trimmedQuery = query.trim().toLowerCase();
  const filteredMembers = useMemo(() => {
    if (!trimmedQuery) return members;
    return members.filter(
      (member) =>
        member.nickname.toLowerCase().includes(trimmedQuery) ||
        member.userID.toLowerCase().includes(trimmedQuery),
    );
  }, [members, trimmedQuery]);

  const d = useMemo(
    () => ({
      container: {
        backgroundColor: colors.background,
      },
      surface: {
        backgroundColor: colors.surface,
      },
      input: {
        color: colors.text,
        ...Typography.bodyRegular,
      },
      rowName: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
    }),
    [colors],
  );

  const handleOpenMember = useCallback(
    async (member: GroupMemberItem) => {
      if (!member.userID) {
        return;
      }

      // review R2 P1：打开成员资料前 fail-closed 现场重查——降权后即便
      // 结果列表还挂在屏上，也不能再跳成员资料（hook 状态翻转会顺带清列表）。
      if (!(await revalidate())) {
        return;
      }

      router.push(
        getUserProfileHref(scope, fromImUserId(member.userID), member.nickname || undefined),
      );
    },
    [revalidate, scope],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<GroupMemberItem>) => {
      const memberName = item.nickname || item.userID;
      return (
        <Pressable
          style={[s.row, d.surface]}
          onPress={() => handleOpenMember(item)}
        >
          <Avatar
            size={40}
            shape="square"
            name={memberName}
            uri={item.faceURL}
          />
          <View style={s.rowText}>
            <Text style={d.rowName} numberOfLines={1}>
              {memberName}
            </Text>
          </View>
        </Pressable>
      );
    },
    [d.rowName, d.surface, handleOpenMember],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('chat.searchGroupMembers')} />

      <View style={[s.searchWrap, d.surface]}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, d.input]}
          placeholder={t('chat.searchGroupMembersPlaceholder')}
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
        <View style={s.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !authorized ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>{t('chat.groupMembersRestricted')}</Text>
        </View>
      ) : filteredMembers.length === 0 ? (
        <View style={s.empty}>
          <Text style={d.emptyText}>
            {trimmedQuery
              ? t('chat.searchGroupMembersNoMatches')
              : t('chat.searchGroupMembersEmpty')}
          </Text>
        </View>
      ) : (
        <FlatList
          style={s.list}
          data={filteredMembers}
          keyExtractor={(item) => item.userID}
          renderItem={renderItem}
          ItemSeparatorComponent={Sep}
          contentContainerStyle={[
            s.listContent,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          {...keyboardDismissOnDragProps}
        />
      )}
    </View>
  );
}
