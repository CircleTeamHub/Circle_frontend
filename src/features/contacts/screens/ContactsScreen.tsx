import { refreshGroupAdmissionUnread } from '@/services/api/group-admissions';
import { Avatar } from '@/components/ui/avatar';
import { useChatStore } from '@/chat-core/store';
import { MemberName } from '@/components/ui/member-name';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { SearchBar } from '@/components/ui/search-bar';
import { ContactIndexBar } from '@/features/contacts/components/ContactIndexBar';
import {
  buildContactSections,
  getFriendDisplayName,
  type ContactFriendSection,
} from '@/features/contacts/contact-friends';
import { getContactListItemLayout } from '@/features/contacts/utils/contact-list-layout';
import { getUserProfileHref } from '@/features/user/utils/routes';
import { fetchFriends, friendsMutatedSince, type FriendProfile } from '@/services/api/friends';
import { useFocusReloadGate } from '@/hooks/use-focus-reload-gate';
import { useAuthStore } from '@/stores/authStore';
import { readPageSnapshot } from '@/storage/page-snapshots';
import { reuseUnchanged } from '@/utils/structural-sharing';
import { useFriendActivityUnreadStore } from '@/stores/friendActivityUnreadStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { Spacing, Typography, useTheme } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  SectionList,
  SectionListData,
  SectionListRenderItemInfo,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { reportHandledFailure } from '@/observability/report-failure';

const QUICK_ACTION_KEYS: {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  key: string;
  iconBg: string;
}[] = [
  { id: 'new-friends', icon: 'person-add', key: 'contacts.newFriends', iconBg: '#F97316' },
  { id: 'groups', icon: 'chatbubbles', key: 'contacts.groups', iconBg: '#22C55E' },
  { id: 'seats', icon: 'chatbubble', key: 'contacts.seats', iconBg: '#3B82F6' },
  { id: 'tags', icon: 'pricetag', key: 'contacts.tags', iconBg: '#A855F7' },
];

// 字母索引要算出远处分组的准确位置(getItemLayout),所以好友行和分组标题都是定高:
// 默认字号下与原先一致(头像 40 上下各 14 = 68,分组标题 32),系统调大字号时按比例加高。
const CONTACT_AVATAR_SIZE = 40;
const CONTACT_ROW_PADDING = 14;
/** 昵称 + 账号两行文字的高度上限估算(默认字号实际约 32)。 */
const CONTACT_ROW_TEXT_HEIGHT = 36;
const SECTION_HEADER_TEXT_HEIGHT = Spacing.md;

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
    justifyContent: 'center',
  },
  contactRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
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
});

export default function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
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
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const [initialFriends] = useState(() => readPageSnapshot<FriendProfile[]>(useAuthStore.getState().user?.id, 'social:friends'));
  const [friends, setFriends] = useState<FriendProfile[]>(() => initialFriends?.value ?? []);
  const hasLoadedRef = useRef(Boolean(initialFriends));
  const [loading, setLoading] = useState(!initialFriends);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  useLayoutEffect(() => {
    const saved = readPageSnapshot<FriendProfile[]>(useAuthStore.getState().user?.id, 'social:friends');
    hasLoadedRef.current = Boolean(saved);
    setFriends(saved?.value ?? []);
    setLoading(!saved);
    setError(null);
  }, [sessionEpoch]);
  const unreadFriendActivityCount = useFriendActivityUnreadStore(
    (state) => state.count,
  );
  const friendActivityCountKnown = useFriendActivityUnreadStore(
    (state) => state.countKnown,
  );
  const groupAdmissionsUnread = useTabBadgeStore((state) => state.groupAdmissionsUnread);
  const refreshUnreadFriendActivityCount = useFriendActivityUnreadStore(
    (state) => state.refresh,
  );

  // 回到通讯录时:刚拉过、之后没有好友相关的写请求、好友动态(对方通过申请等实时事件)
  // 也没变,就不重拉 —— 好友多的用户进出聊天页、资料页每次都整表重拉很费电。
  const friendsReloadGate = useFocusReloadGate({
    key: unreadFriendActivityCount,
    mutatedSince: friendsMutatedSince,
  });

  const loadFriends = useCallback(async () => {
    const startedAt = Date.now();
    if (!hasLoadedRef.current) setLoading(true);

    try {
      const nextFriends = await fetchFriends();
      if (!mountedRef.current || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      hasLoadedRef.current = true;
      useChatStore.getState().syncPeerAvatars(nextFriends);
      // 内容没变的好友沿用旧对象,列表行不必全部重渲染。
      setFriends((current) => reuseUnchanged(current, nextFriends));
      setError(null);
      friendsReloadGate.markLoaded(startedAt);
    } catch (error) {
      if (!mountedRef.current || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      setError(t('contacts.loadFailed'));
      reportHandledFailure('contacts', 'fetchFriends', error);
    } finally {
      if (mountedRef.current && useAuthStore.getState().sessionEpoch === sessionEpoch) setLoading(false);
    }
  }, [friendsReloadGate, sessionEpoch, t]);

  useFocusEffect(
    useCallback(() => {
      if (!friendsReloadGate.shouldSkip()) void loadFriends();
      void refreshUnreadFriendActivityCount();
      void refreshGroupAdmissionUnread().catch(error => reportHandledFailure('groupAdmission', 'unread', error));
    }, [friendsReloadGate, loadFriends, refreshUnreadFriendActivityCount]),
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
  // 只列出有好友的字母(微信同款):每个字母都对应一个真实分组,点哪个就落到哪个的标题上。
  const indexLetters = useMemo(() => sections.map((section) => section.title), [sections]);
  const listRef = useRef<SectionList<FriendProfile, ContactFriendSection>>(null);
  const listHeaderHeightRef = useRef(0);

  const rowMetrics = useMemo(
    () => ({
      rowHeight:
        Math.max(CONTACT_AVATAR_SIZE, Math.ceil(CONTACT_ROW_TEXT_HEIGHT * fontScale)) +
        CONTACT_ROW_PADDING * 2,
      sectionHeaderHeight: Math.ceil(SECTION_HEADER_TEXT_HEIGHT * fontScale) + Spacing.sm * 2,
    }),
    [fontScale],
  );

  const getItemLayout = useCallback(
    (data: SectionListData<FriendProfile, ContactFriendSection>[] | null, index: number) =>
      getContactListItemLayout(data ?? [], index, {
        listHeaderHeight: listHeaderHeightRef.current,
        ...rowMetrics,
      }),
    [rowMetrics],
  );

  const handleListHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    listHeaderHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  // 不带动画:按住滑动时每过一个字母就要立刻到位,动画只会让列表追着手指晃。
  const handleSelectIndexLetter = useCallback((sectionIndex: number) => {
    listRef.current?.scrollToLocation({ sectionIndex, itemIndex: 0, animated: false });
  }, []);

  const indexAreaStyle = useMemo(() => ({ top: insets.top + 200, bottom: 100 }), [insets.top]);

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
      sectionHeader: {
        height: rowMetrics.sectionHeaderHeight,
      },
      contactItem: {
        height: rowMetrics.rowHeight,
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
    [colors, rowMetrics],
  );

  const handleAddFriend = useCallback(() => {
    router.push('/(tabs)/contacts/add-friend');
  }, [router]);

  const handleOpenSearch = useCallback(() => {
    router.push('/(tabs)/contacts/search');
  }, [router]);

  const handleOpenFriend = useCallback(
    (friend: FriendProfile) => {
      router.navigate(
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
      <View testID={`contacts-row-${item.id}`} style={d.contactItem}>
        <Pressable style={s.contactRow} onPress={() => handleOpenFriend(item)}>
          <Avatar
            size={CONTACT_AVATAR_SIZE}
            name={getFriendDisplayName(item)}
            uri={item.avatarUrl ?? undefined}
          />
          <View style={s.contactMeta}>
            <MemberName
              name={getFriendDisplayName(item)}
              userId={item.id}
              style={d.contactName}
              numberOfLines={1}
            />
            <Text style={d.contactAccountId} numberOfLines={1}>
              {t('contacts.accountId', { id: item.accountId })}
            </Text>
          </View>
        </Pressable>
        {index < section.data.length - 1 && <Divider />}
      </View>
    ),
    [d, handleOpenFriend, t],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<FriendProfile, ContactFriendSection> }) => (
      <View testID={`contacts-section-${section.title}`} style={[s.sectionHeader, d.sectionHeader]}>
        <Text style={d.sectionLetter} numberOfLines={1}>{section.title}</Text>
      </View>
    ),
    [d],
  );

  const keyExtractor = useCallback((item: FriendProfile) => item.id, []);

  const ListHeader = (
    <View testID="contacts-list-header" style={s.headerSection} onLayout={handleListHeaderLayout}>
      <View style={s.titleRow}>
        <Text style={d.title}>{t('contacts.title')}</Text>
        <Pressable
          testID={E2E_TEST_IDS.contactsAddFriend}
          onPress={handleAddFriend}
        >
          <Ionicons name="person-add-outline" size={24} color={colors.text} />
        </Pressable>
      </View>
      <SearchBar placeholder={t('contacts.searchPlaceholder')} onPress={handleOpenSearch} />
      <View style={s.quickActions}>
        {QUICK_ACTIONS.map((action, index) => {
          const badgeCount =
            action.id === 'new-friends'
              ? groupAdmissionsUnread + (friendActivityCountKnown ? unreadFriendActivityCount : 0)
              : 0;
          return (
            <View key={action.label}>
              <MenuRow
                icon={action.icon}
                iconBgColor={action.iconBg}
                label={action.label}
                badgeCount={badgeCount}
                onPress={() => handleQuickActionPress(action.id)}
              />
              {index < QUICK_ACTIONS.length - 1 ? <Divider /> : null}
            </View>
          );
        })}
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
    <View
      testID={E2E_TEST_IDS.contactsScreen}
      style={[d.container, { paddingTop: insets.top }]}
    >
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        getItemLayout={getItemLayout}
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
      {indexLetters.length > 0 ? (
        <ContactIndexBar
          letters={indexLetters}
          onSelect={handleSelectIndexLetter}
          style={indexAreaStyle}
        />
      ) : null}
    </View>
  );
}
