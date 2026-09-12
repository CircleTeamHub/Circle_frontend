import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import {
  buildContactSections,
  getFriendDisplayName,
  type ContactFriendSection,
} from '@/features/contacts/contact-friends';
import { getUserProfileHref } from '@/features/user/utils/routes';
import {
  assignFriendTag,
  fetchFriends,
  fetchFriendsByTag,
  type FriendProfile,
} from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SectionList,
  SectionListData,
  SectionListRenderItemInfo,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  sectionHeader: { paddingVertical: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 14,
  },
  rowMeta: {
    flex: 1,
    gap: 2,
  },
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: 56,
  },
  retryButton: {
    minWidth: 96,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  headerAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerSheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    maxHeight: '78%',
  },
  pickerHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  pickerSearch: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderRadius: Radius.xxl,
  },
  pickerInput: {
    flex: 1,
    padding: 0,
    ...Typography.bodyRegular,
  },
  pickerList: {
    maxHeight: 420,
  },
  pickerListContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  pickerMeta: {
    flex: 1,
    gap: 2,
  },
  pickerEmpty: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
});

export default function FriendTagDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addFriendsVisible, setAddFriendsVisible] = useState(false);
  const [candidateFriends, setCandidateFriends] = useState<FriendProfile[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [assigningFriendId, setAssigningFriendId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const friendsRequestRef = useRef(0);
  const optimisticFriendsRef = useRef(new Map<string, FriendProfile>());
  const candidateRequestRef = useRef(0);
  const assigningFriendRef = useRef<string | null>(null);

  const tagId = typeof params.id === 'string' ? params.id : '';
  const tagName = typeof params.name === 'string' ? params.name : t('contacts.tagDetail.fallbackTitle');

  const loadFriends = useCallback(async () => {
    if (!tagId) {
      if (!mountedRef.current) return;
      setError(t('contacts.tagDetail.notExist'));
      setLoading(false);
      return;
    }

    const request = ++friendsRequestRef.current;
    setLoading(true);

    try {
      const nextFriends = await fetchFriendsByTag(tagId);
      if (!mountedRef.current || request !== friendsRequestRef.current) return;
      const nextFriendIds = new Set(nextFriends.map((friend) => friend.id));
      const optimisticFriends = [...optimisticFriendsRef.current.values()]
        .filter((friend) => !nextFriendIds.has(friend.id));
      for (const friend of nextFriends) {
        optimisticFriendsRef.current.delete(friend.id);
      }
      setFriends([...nextFriends, ...optimisticFriends]);
      setError(null);
    } catch {
      if (!mountedRef.current || request !== friendsRequestRef.current) return;
      setError(t('contacts.tagDetail.loadFailed'));
    } finally {
      if (mountedRef.current && request === friendsRequestRef.current) setLoading(false);
    }
  }, [t, tagId]);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleRefreshFriends = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await loadFriends();
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [loadFriends]);

  const loadCandidateFriends = useCallback(async () => {
    if (!tagId) return;
    const request = ++candidateRequestRef.current;
    setCandidateLoading(true);
    setCandidateError(null);
    try {
      const nextFriends = await fetchFriends();
      if (!mountedRef.current || request !== candidateRequestRef.current) return;
      setCandidateFriends(nextFriends);
    } catch (caughtError) {
      if (!mountedRef.current || request !== candidateRequestRef.current) return;
      setCandidateError(
        getApiErrorMessage(caughtError, t('contacts.tagDetail.candidatesLoadFailed')),
      );
    } finally {
      if (mountedRef.current && request === candidateRequestRef.current) {
        setCandidateLoading(false);
      }
    }
  }, [t, tagId]);

  useEffect(() => {
    if (addFriendsVisible) {
      void loadCandidateFriends();
    } else {
      setCandidateQuery('');
    }
  }, [addFriendsVisible, loadCandidateFriends]);

  const handleAssignFriend = useCallback(
    async (friend: FriendProfile) => {
      if (!tagId || assigningFriendRef.current) return;
      assigningFriendRef.current = friend.id;
      setAssigningFriendId(friend.id);
      try {
        await assignFriendTag(friend.id, tagId);
        if (!mountedRef.current) return;
        // Only a successful assignment invalidates older list responses. Doing
        // this before the POST would also invalidate their finally blocks on a
        // failed POST and could leave the screen permanently loading.
        friendsRequestRef.current += 1;
        optimisticFriendsRef.current.set(friend.id, friend);
        setFriends((current) =>
          current.some((item) => item.id === friend.id) ? current : [...current, friend],
        );
        void loadFriends();
      } catch (caughtError) {
        if (!mountedRef.current) return;
        Alert.alert(
          t('contacts.tagDetail.addFailedTitle'),
          getApiErrorMessage(caughtError, t('contacts.tagDetail.addFailed')),
        );
      } finally {
        assigningFriendRef.current = null;
        if (mountedRef.current) setAssigningFriendId(null);
      }
    },
    [loadFriends, t, tagId],
  );

  const sections = useMemo(() => buildContactSections(friends), [friends]);

  const unassignedFriends = useMemo(() => {
    const assignedIds = new Set(friends.map((friend) => friend.id));
    return candidateFriends.filter((friend) => !assignedIds.has(friend.id));
  }, [candidateFriends, friends]);

  const visibleCandidates = useMemo(() => {
    const keyword = candidateQuery.trim().toLowerCase();
    if (!keyword) return unassignedFriends;
    return unassignedFriends.filter((friend) => {
      const name = getFriendDisplayName(friend).toLowerCase();
      return name.includes(keyword) || friend.accountId.toLowerCase().includes(keyword);
    });
  }, [candidateQuery, unassignedFriends]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      sectionTitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      name: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '500' as const,
      },
      account: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
      stateText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      retryButton: {
        backgroundColor: colors.primary,
      },
      retryButtonText: {
        color: colors.white,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
      pickerSheet: {
        backgroundColor: colors.surface,
      },
      pickerHandle: {
        backgroundColor: colors.surfaceBorder,
      },
      pickerTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      pickerSearch: {
        backgroundColor: colors.background,
      },
      pickerInput: {
        color: colors.text,
      },
      pickerName: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '500' as const,
      },
      pickerAccount: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
      pickerEmpty: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
    }),
    [colors],
  );

  const renderItem = useCallback(
    ({
      item,
      index,
      section,
    }: SectionListRenderItemInfo<FriendProfile, ContactFriendSection>) => (
      <View>
        <Pressable
          style={s.row}
          onPress={() =>
            router.push(
              getUserProfileHref(
                'contacts',
                item.id,
                getFriendDisplayName(item),
              ),
            )
          }
        >
          <Avatar
            size={40}
            name={getFriendDisplayName(item)}
            uri={item.avatarUrl ?? undefined}
          />
          <View style={s.rowMeta}>
            <MemberName
              name={getFriendDisplayName(item)}
              userId={item.id}
              style={d.name}
            />
            <Text style={d.account}>{t('contacts.accountId', { id: item.accountId })}</Text>
          </View>
        </Pressable>
        {index < section.data.length - 1 ? <Divider /> : null}
      </View>
    ),
    [d, router, t],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<FriendProfile, ContactFriendSection> }) => (
      <View style={s.sectionHeader}>
        <Text style={d.sectionTitle}>{section.title}</Text>
      </View>
    ),
    [d],
  );

  const emptyState = loading && friends.length === 0 ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>{t('contacts.tagDetail.loading')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      <Pressable style={[s.retryButton, d.retryButton]} onPress={loadFriends}>
        <Text style={d.retryButtonText}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  ) : (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{t('contacts.tagDetail.empty')}</Text>
    </View>
  );

  const pickerEmptyText = candidateQuery.trim()
    ? t('contacts.tagDetail.noMatch')
    : t('contacts.tagDetail.noCandidates');

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={tagName}
        rightSlot={
          <Pressable
            style={s.headerAction}
            onPress={() => setAddFriendsVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t('contacts.tagDetail.addFriends')}
          >
            <Ionicons name="person-add-outline" size={22} color={colors.iconAccent} />
          </Pressable>
        }
      />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListEmptyComponent={emptyState}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        refreshing={refreshing}
        onRefresh={handleRefreshFriends}
      />
      <BottomSheetModal
        visible={addFriendsVisible}
        onClose={() => setAddFriendsVisible(false)}
        sheetStyle={[s.pickerSheet, d.pickerSheet, { paddingBottom: insets.bottom || Spacing.lg }]}
      >
        <View style={[s.pickerHandle, d.pickerHandle]} />
        <View style={s.pickerHeader}>
          <Text style={d.pickerTitle}>{t('contacts.tagDetail.addFriends')}</Text>
          <Pressable
            onPress={() => setAddFriendsVisible(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
        <View style={[s.pickerSearch, d.pickerSearch]}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            style={[s.pickerInput, d.pickerInput]}
            value={candidateQuery}
            onChangeText={setCandidateQuery}
            placeholder={t('contacts.tagDetail.searchPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {candidateQuery ? (
            <Pressable
              onPress={() => setCandidateQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('common.clear')}
            >
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        {candidateLoading ? (
          <View style={s.pickerEmpty}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : candidateError ? (
          <View style={s.pickerEmpty}>
            <Text style={d.pickerEmpty}>{candidateError}</Text>
            <Pressable
              style={[s.retryButton, d.retryButton]}
              onPress={() => void loadCandidateFriends()}
            >
              <Text style={d.retryButtonText}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : visibleCandidates.length === 0 ? (
          <View style={s.pickerEmpty}>
            <Text style={d.pickerEmpty}>{pickerEmptyText}</Text>
          </View>
        ) : (
          <FlatList
            data={visibleCandidates}
            keyExtractor={(item) => item.id}
            style={s.pickerList}
            contentContainerStyle={s.pickerListContent}
            {...keyboardDismissOnDragProps}
            renderItem={({ item }) => {
              const name = getFriendDisplayName(item);
              const assigning = assigningFriendId === item.id;
              return (
                <Pressable
                  style={s.pickerRow}
                  onPress={() => void handleAssignFriend(item)}
                  disabled={Boolean(assigningFriendId)}
                  accessibilityRole="button"
                  accessibilityLabel={t('contacts.tagDetail.addFriendAction', { name })}
                >
                  <Avatar size={40} name={name} uri={item.avatarUrl ?? undefined} />
                  <View style={s.pickerMeta}>
                    <Text style={d.pickerName} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={d.pickerAccount} numberOfLines={1}>
                      {t('contacts.accountId', { id: item.accountId })}
                    </Text>
                  </View>
                  {assigning ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Ionicons name="add-circle-outline" size={22} color={colors.iconAccent} />
                  )}
                </Pressable>
              );
            }}
          />
        )}
      </BottomSheetModal>
    </View>
  );
}
