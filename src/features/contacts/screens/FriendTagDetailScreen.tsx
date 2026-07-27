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
import { fetchFriendsByTag, type FriendProfile } from '@/services/api/friends';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  SectionListData,
  SectionListRenderItemInfo,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  summaryCard: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: 6,
  },
  sectionHeader: {
    paddingVertical: Spacing.sm,
  },
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
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);

  const tagId = typeof params.id === 'string' ? params.id : '';
  const tagName = typeof params.name === 'string' ? params.name : t('contacts.tagDetail.fallbackTitle');

  const loadFriends = useCallback(async () => {
    if (!tagId) {
      if (!mountedRef.current) return;
      setError(t('contacts.tagDetail.notExist'));
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const nextFriends = await fetchFriendsByTag(tagId);
      if (!mountedRef.current) return;
      setFriends(nextFriends);
      setError(null);
    } catch {
      if (!mountedRef.current) return;
      setError(t('contacts.tagDetail.loadFailed'));
    } finally {
      if (mountedRef.current) setLoading(false);
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

  const sections = useMemo(() => buildContactSections(friends), [friends]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      summaryCard: {
        backgroundColor: colors.surface,
      },
      summaryTitle: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      summaryCopy: {
        color: colors.textSecondary,
        ...Typography.small,
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

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={tagName} />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListHeaderComponent={
          <View style={[s.summaryCard, d.summaryCard]}>
            <Text style={d.summaryTitle}>{tagName}</Text>
            <Text style={d.summaryCopy}>{t('contacts.tagDetail.summary')}</Text>
          </View>
        }
        ListEmptyComponent={emptyState}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        refreshing={refreshing}
        onRefresh={handleRefreshFriends}
      />
    </View>
  );
}
