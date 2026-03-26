import { useRouter, useSegments } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { getUserProfileHref, type UserProfileScope } from '@/features/user/utils/routes';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  category: '联系人' | '对话';
  meta: string;
  profileId?: string;
}

interface SearchSection {
  title: '对话' | '联系人';
  data: SearchResultItem[];
}

const RECENT_SEARCHES = ['陈思琪', '工作群', '王浩然'];

const MOCK_RESULTS: SearchResultItem[] = [
  { id: 'chat-1', title: 'Circle 产品群', subtitle: '6 条相关消息', category: '对话', meta: '下午 4:20' },
  { id: 'chat-2', title: '周末羽毛球局', subtitle: '3 条相关消息', category: '对话', meta: '昨天' },
  { id: 'chat-3', title: '陈思琪', subtitle: '嘿！今晚还是一起吃饭吗？', category: '对话', meta: '下午 3:34', profileId: 'chen-siqi' },
  { id: 'contact-1', title: '陈思琪', subtitle: '联系人 · 最近活跃', category: '联系人', meta: '在线', profileId: 'chen-siqi' },
  { id: 'contact-2', title: '王浩然', subtitle: '联系人 · 共同好友 3 人', category: '联系人', meta: '深圳', profileId: 'wang-haoran' },
  { id: 'contact-3', title: '周子涵', subtitle: '联系人 · 同城推荐', category: '联系人', meta: '杭州', profileId: 'zhou-zihan' },
];

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  const currentScope: UserProfileScope = useMemo(() => {
    const scope = segments[1];

    if (scope === 'contacts') {
      return 'contacts';
    }

    if (scope === 'profile') {
      return 'profile';
    }

    return 'messages';
  }, [segments]);

  const filteredResults = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return MOCK_RESULTS;
    }

    return MOCK_RESULTS.filter((item) => {
      const haystack = `${item.title}${item.subtitle}${item.category}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query]);

  const groupedResults = useMemo<SearchSection[]>(() => {
    const chats = filteredResults.filter((item) => item.category === '对话');
    const contacts = filteredResults.filter((item) => item.category === '联系人');

    const sections: SearchSection[] = [
      { title: '对话', data: chats },
      { title: '联系人', data: contacts },
    ];

    return sections.filter((section) => section.data.length > 0);
  }, [filteredResults]);

  const handleOpenUserProfile = (item: SearchResultItem) => {
    if (!item.profileId) {
      return;
    }

    router.push(getUserProfileHref(currentScope, item.profileId, item.title));
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        listContent: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        },
        headerContent: {
          gap: Spacing.lg,
        },
        searchBox: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          height: 48,
          paddingHorizontal: Spacing.md,
          borderRadius: Radius.xxl,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.surfaceBorder,
        },
        input: {
          flex: 1,
          color: colors.text,
          ...Typography.bodyRegular,
          padding: 0,
        },
        sectionHeader: {
          paddingTop: Spacing.lg,
          paddingBottom: Spacing.sm,
        },
        sectionTitle: {
          color: colors.text,
          ...Typography.h3,
        },
        recentBlock: {
          gap: Spacing.md,
        },
        recentTitle: {
          color: colors.text,
          ...Typography.h3,
        },
        recentRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: Spacing.sm,
        },
        recentChip: {
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.sm,
          borderRadius: Radius.full,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.surfaceBorder,
        },
        recentChipText: {
          color: colors.textSecondary,
          ...Typography.caption,
        },
        resultRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.md,
          paddingVertical: Spacing.md,
        },
        resultBody: {
          flex: 1,
          gap: Spacing.xs,
        },
        resultTopRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        resultTitle: {
          color: colors.text,
          fontSize: 15,
          fontWeight: '600',
          flex: 1,
          marginRight: Spacing.sm,
        },
        resultSubtitle: {
          color: colors.textSecondary,
          ...Typography.caption,
        },
        resultMeta: {
          color: colors.textSecondary,
          ...Typography.small,
        },
        emptyText: {
          color: colors.textSecondary,
          ...Typography.bodyRegular,
          textAlign: 'center',
          paddingTop: Spacing.xl,
        },
      }),
    [colors, insets.bottom],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title="搜索" />
      <SectionList
        sections={groupedResults}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                placeholder="搜索对话或联系人"
                placeholderTextColor={colors.textSecondary}
              />
            </View>
            {!query ? (
              <View style={styles.recentBlock}>
                <Text style={styles.recentTitle}>最近搜索</Text>
                <View style={styles.recentRow}>
                  {RECENT_SEARCHES.map((item) => (
                    <Pressable
                      key={item}
                      style={styles.recentChip}
                      onPress={() => setQuery(item)}
                    >
                      <Text style={styles.recentChipText}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View>
            <Pressable
              style={styles.resultRow}
              onPress={() => handleOpenUserProfile(item)}
            >
              {item.profileId ? (
                <Pressable
                  onPress={() =>
                    handleOpenUserProfile(item)
                  }
                >
                  <Avatar size={40} name={item.title} />
                </Pressable>
              ) : (
                <Avatar size={40} name={item.title} />
              )}
              <View style={styles.resultBody}>
                <View style={styles.resultTopRow}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.resultMeta}>{item.meta}</Text>
                </View>
                <Text style={styles.resultSubtitle} numberOfLines={1}>
                  {item.subtitle}
                </Text>
              </View>
            </Pressable>
            {index < section.data.length - 1 ? <Divider /> : null}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>暂无匹配结果</Text>}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
