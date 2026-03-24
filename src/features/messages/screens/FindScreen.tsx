import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  category: '联系人' | '聊天' | '动态';
}

const RECENT_SEARCHES = ['陈思琪', '工作群', '拉面馆'];

const MOCK_RESULTS: SearchResultItem[] = [
  { id: '1', title: '陈思琪', subtitle: '联系人 · 最近活跃', category: '联系人' },
  { id: '2', title: '周末天台酒吧', subtitle: '聊天 · 6 条相关消息', category: '聊天' },
  { id: '3', title: '日式拉面馆', subtitle: '动态 · 2 条相关内容', category: '动态' },
  { id: '4', title: '王浩然', subtitle: '联系人 · 共同好友 3 人', category: '联系人' },
];

export default function FindScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        content: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
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
        section: {
          gap: Spacing.md,
        },
        sectionTitle: {
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
        resultCard: {
          backgroundColor: colors.surface,
          borderRadius: Radius.lg,
          paddingHorizontal: Spacing.md,
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
        resultTitle: {
          color: colors.text,
          ...Typography.body,
        },
        resultSubtitle: {
          color: colors.textSecondary,
          ...Typography.bodyRegular,
        },
        categoryBadge: {
          alignSelf: 'flex-start',
          paddingHorizontal: Spacing.sm,
          paddingVertical: 2,
          borderRadius: Radius.full,
          backgroundColor: colors.primaryLight,
        },
        categoryText: {
          color: colors.primary,
          ...Typography.small,
        },
        emptyText: {
          color: colors.textSecondary,
          ...Typography.bodyRegular,
        },
      }),
    [colors, insets.bottom],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title="查找" />
      <FlatList
        data={filteredResults}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.section}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                placeholder="搜索联系人、聊天或动态"
                placeholderTextColor={colors.textSecondary}
              />
            </View>
            {!query ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>最近搜索</Text>
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
            <Text style={styles.sectionTitle}>搜索结果</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={styles.resultCard}>
            <Pressable style={styles.resultRow}>
              <Avatar size={40} name={item.title} />
              <View style={styles.resultBody}>
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryText}>{item.category}</Text>
                </View>
                <Text style={styles.resultTitle}>{item.title}</Text>
                <Text style={styles.resultSubtitle}>{item.subtitle}</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
            {index < filteredResults.length - 1 ? <Divider /> : null}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>暂无匹配结果</Text>
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
