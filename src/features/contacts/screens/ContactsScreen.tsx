import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { SearchBar } from '@/components/ui/search-bar';
import {
  buildContactSections,
  getFriendDisplayName,
  type ContactFriendSection,
} from '@/features/contacts/contact-friends';
import { getUserProfileHref } from '@/features/user/utils/routes';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { useFriendActivityUnreadStore } from '@/stores/friendActivityUnreadStore';
import { Spacing, Typography, useTheme } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SectionList,
  SectionListData,
  SectionListRenderItemInfo,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const QUICK_ACTION_KEYS: {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  key: string;
  iconBg: string;
}[] = [
  { id: 'new-friends', icon: 'person-add', key: 'contacts.newFriends', iconBg: '#F97316' },
  { id: 'seats', icon: 'chatbubble', key: 'contacts.seats', iconBg: '#3B82F6' },
  { id: 'groups', icon: 'chatbubbles', key: 'contacts.groups', iconBg: '#22C55E' },
  { id: 'circles', icon: 'people-circle', key: 'contacts.circles', iconBg: '#14B8A6' },
  { id: 'tags', icon: 'pricetag', key: 'contacts.tags', iconBg: '#A855F7' },
];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');

const s = StyleSheet.create({
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 100,
  },
  headerSection: {
    gap: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quickActions: {
    marginBottom: Spacing.sm,
  },
  sectionHeader: {
    paddingVertical: Spacing.sm,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 14,
  },
  contactMeta: {
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
  alphabetIndex: {
    position: 'absolute',
    right: 4,
    width: 14,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 1,
  },
});

export default function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const QUICK_ACTIONS = useMemo(
    () =>
      QUICK_ACTION_KEYS.map((a) => ({
        id: a.id,
        icon: a.icon,
        label: t(a.key),
        iconBg: a.iconBg,
      })),
    [t],
  );
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const unreadFriendActivityCount = useFriendActivityUnreadStore(
    (state) => state.count,
  );
  const refreshUnreadFriendActivityCount = useFriendActivityUnreadStore(
    (state) => state.refresh,
  );

  const loadFriends = useCallback(async () => {
    setLoading(true);

    try {
      const nextFriends = await fetchFriends();
      if (!mountedRef.current) return;
      setFriends(nextFriends);
      setError(null);
    } catch (error) {
      if (!mountedRef.current) return;
      setError(t('contacts.loadFailed'));
      if (__DEV__) {
        console.warn('[ContactsScreen] fetchFriends failed', error);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void loadFriends();
      void refreshUnreadFriendActivityCount();
    }, [loadFriends, refreshUnreadFriendActivityCount]),
  );

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
      await Promise.all([loadFriends(), refreshUnreadFriendActivityCount()]);
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [loadFriends, refreshUnreadFriendActivityCount]);

  const sections = useMemo(() => buildContactSections(friends), [friends]);
  const alphabet = useMemo(() => {
    const sectionTitles = new Set(sections.map((section) => section.title));
    return ALPHABET.filter((letter) => sectionTitles.has(letter));
  }, [sections]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      title: {
        color: colors.text,
        ...Typography.title,
      },
      sectionLetter: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      contactName: {
        color: colors.text,
        fontSize: 15,
        fontWeight: '500' as const,
      },
      contactAccountId: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
      alphabetLetter: {
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

  const handleAddFriend = useCallback(() => {
    router.push('/(tabs)/contacts/add-friend');
  }, [router]);

  const handleOpenSearch = useCallback(() => {
    router.push('/(tabs)/contacts/search');
  }, [router]);

  const handleOpenFriend = useCallback(
    (friend: FriendProfile) => {
      router.push(
        getUserProfileHref(
          'contacts',
          friend.id,
          getFriendDisplayName(friend),
        ),
      );
    },
    [router],
  );

  const handleQuickActionPress = useCallback(
    (id: string) => {
      if (id === 'new-friends') {
        router.push('/(tabs)/contacts/new-friends');
      } else if (id === 'seats') {
        router.push('/(tabs)/contacts/seats');
      } else if (id === 'groups') {
        router.push('/(tabs)/contacts/groups');
      } else if (id === 'circles') {
        router.push('/(tabs)/contacts/circles');
      } else if (id === 'tags') {
        router.push('/(tabs)/contacts/tags');
      }
    },
    [router],
  );

  const renderItem = useCallback(
    ({
      item,
      index,
      section,
    }: SectionListRenderItemInfo<FriendProfile, ContactFriendSection>) => (
      <View>
        <Pressable style={s.contactRow} onPress={() => handleOpenFriend(item)}>
          <Avatar
            size={40}
            name={getFriendDisplayName(item)}
            uri={item.avatarUrl ?? undefined}
          />
          <View style={s.contactMeta}>
            <Text style={d.contactName}>{getFriendDisplayName(item)}</Text>
            <Text style={d.contactAccountId}>{t('contacts.accountId', { id: item.accountId })}</Text>
          </View>
        </Pressable>
        {index < section.data.length - 1 && <Divider />}
      </View>
    ),
    [d, handleOpenFriend, t],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<FriendProfile, ContactFriendSection> }) => (
      <View style={s.sectionHeader}>
        <Text style={d.sectionLetter}>{section.title}</Text>
      </View>
    ),
    [d],
  );

  const keyExtractor = useCallback((item: FriendProfile) => item.id, []);

  const ListHeader = (
    <View style={s.headerSection}>
      <View style={s.titleRow}>
        <Text style={d.title}>{t('contacts.title')}</Text>
        <Pressable onPress={handleAddFriend}>
          <Ionicons name="person-add-outline" size={24} color={colors.text} />
        </Pressable>
      </View>
      <SearchBar placeholder={t('contacts.searchPlaceholder')} onPress={handleOpenSearch} />
      <View style={s.quickActions}>
        {QUICK_ACTIONS.map((action, index) => (
          <View key={action.label}>
            <MenuRow
              icon={action.icon}
              iconBgColor={action.iconBg}
              label={action.label}
              showIndicatorDot={
                action.id === 'new-friends' && unreadFriendActivityCount > 0
              }
              onPress={() => handleQuickActionPress(action.id)}
            />
            {index < QUICK_ACTIONS.length - 1 ? <Divider /> : null}
          </View>
        ))}
      </View>
    </View>
  );

  const stateBlock = loading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>{t('contacts.loadingContacts')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      <Pressable style={[s.retryButton, d.retryButton]} onPress={loadFriends}>
        <Text style={d.retryButtonText}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  ) : friends.length === 0 ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{t('contacts.noFriends')}</Text>
    </View>
  ) : null;

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={stateBlock}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshing={refreshing}
        onRefresh={handleRefreshFriends}
      />
      {alphabet.length > 0 ? (
        <View
          style={[s.alphabetIndex, { top: insets.top + 200, bottom: 100 }]}
        >
          {alphabet.map((letter) => (
            <Text key={letter} style={d.alphabetLetter}>
              {letter}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
