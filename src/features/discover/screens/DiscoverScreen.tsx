import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { PostCard } from '@/features/discover/components/post-card';
import type { Post } from '@/types';

const FILTER_TABS = ['圈子广场', '我的圈子', '笔记'];

const MOCK_POSTS: Post[] = [
  {
    id: '1',
    author: '张明远',
    badge: '生活圈',
    time: '2小时前',
    content:
      '今天天气真好，和朋友去了城市公园野餐🌿阳光正好，微风不燥，太舒服了！',
    imageUrl:
      'https://images.unsplash.com/photo-1607949121620-003726aa6e04?w=400',
    likes: 24,
    comments: 8,
  },
  {
    id: '2',
    author: '李晓婷',
    badge: '美食圈',
    time: '5小时前',
    content:
      '发现一家超赞的日式拉面馆！汤底浓郁，叉烧入口即化，强烈推荐🍜',
    imageUrl:
      'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400',
    likes: 42,
    comments: 15,
  },
];

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState(0);

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: 100,
    },
    listHeader: {
      gap: Spacing.md,
      marginBottom: Spacing.md,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: {
      color: colors.text,
      ...Typography.title,
    },
    headerIcons: {
      flexDirection: 'row',
      gap: Spacing.md,
      alignItems: 'center',
    },
    separator: {
      height: Spacing.md,
    },
    fab: {
      position: 'absolute',
      right: Spacing.lg,
      bottom: 110,
      width: 52,
      height: 52,
      borderRadius: Radius.pill,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
  }), [colors]);

  const renderItem = useCallback(
    ({ item }: { item: Post }) => <PostCard post={item} />,
    [],
  );

  const keyExtractor = useCallback((item: Post) => item.id, []);

  const ListHeader = (
    <View style={styles.listHeader}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>动态</Text>
        <View style={styles.headerIcons}>
          <Pressable>
            <Ionicons name="options-outline" size={22} color={colors.text} />
          </Pressable>
          <Pressable>
            <Ionicons
              name="settings-outline"
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      {/* Filter tabs */}
      <FilterTabs
        tabs={FILTER_TABS}
        activeIndex={activeTab}
        onTabPress={setActiveTab}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={MOCK_POSTS}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + Spacing.md - 4 },
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      <Pressable
        style={styles.fab}
        onPress={() => router.push('/create-post')}
      >
        <Ionicons name="add" size={24} color={colors.white} />
      </Pressable>
    </View>
  );
}
