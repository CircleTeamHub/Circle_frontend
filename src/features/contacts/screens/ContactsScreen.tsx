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
import { useCallback, useMemo, useState } from 'react';
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

const QUICK_ACTIONS: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  iconBg: string;
}[] = [
  { icon: 'person-add', label: '新的朋友', iconBg: '#F97316' },
  { icon: 'chatbubble', label: '坐席', iconBg: '#3B82F6' },
  { icon: 'chatbubbles', label: '群聊', iconBg: '#22C55E' },
  { icon: 'pricetag', label: '标签', iconBg: '#A855F7' },
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
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      setFriends(nextFriends);
      setError(null);
    } catch {
      setError('联系人加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadFriends();
      void refreshUnreadFriendActivityCount();
    }, [loadFriends, refreshUnreadFriendActivityCount]),
  );

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
    router.push('/(tabs)/contacts/add-friend');
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
    (label: string) => {
      if (label === '新的朋友') {
        router.push('/(tabs)/contacts/new-friends');
        return;
      }

      if (label === '群聊') {
        router.push('/(tabs)/contacts/groups');
        return;
      }

      if (label === '标签') {
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
            <Text style={d.contactAccountId}>账号：{item.accountId}</Text>
          </View>
        </Pressable>
        {index < section.data.length - 1 && <Divider />}
      </View>
    ),
    [d, handleOpenFriend],
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
        <Text style={d.title}>联系人</Text>
        <Pressable onPress={handleAddFriend}>
          <Ionicons name="person-add-outline" size={24} color={colors.text} />
        </Pressable>
      </View>
      <SearchBar placeholder="搜索账号或好友..." onPress={handleOpenSearch} />
      <View style={s.quickActions}>
        {QUICK_ACTIONS.map((action, index) => (
          <View key={action.label}>
            <MenuRow
              icon={action.icon}
              iconBgColor={action.iconBg}
              label={action.label}
              showIndicatorDot={
                action.label === '新的朋友' && unreadFriendActivityCount > 0
              }
              onPress={() => handleQuickActionPress(action.label)}
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
      <Text style={d.stateText}>正在加载联系人...</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      <Pressable style={[s.retryButton, d.retryButton]} onPress={loadFriends}>
        <Text style={d.retryButtonText}>重试</Text>
      </Pressable>
    </View>
  ) : friends.length === 0 ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>还没有添加好友</Text>
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
