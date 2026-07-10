import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import type { Circle } from '@/types';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const s = StyleSheet.create({
  searchWrap: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.xxl,
    height: 40,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    ...Typography.bodyRegular,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  info: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
  },
  cappedNotice: {
    paddingVertical: Spacing.sm,
  },
});

export default function DiscoverCirclesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);

  const {
    allCircles,
    allCirclesTotal,
    allCirclesLoading,
    allCirclesError,
    fetchAllCircles,
  } = useCirclesStore(
    useShallow((s) => ({
      allCircles: s.allCircles,
      allCirclesTotal: s.allCirclesTotal,
      allCirclesLoading: s.allCirclesLoading,
      allCirclesError: s.allCirclesError,
      fetchAllCircles: s.fetchAllCircles,
    })),
  );

  useEffect(() => {
    fetchAllCircles();
  }, [fetchAllCircles]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleRefreshCircles = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await fetchAllCircles();
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [fetchAllCircles]);

  // 列表被服务端 limit 截断：本地搜索搜不到截断之外的圈子，给用户一个明确提示，
  // 避免「搜了真实存在的圈子却查无结果」被误以为是空数据。
  const capped = allCirclesTotal > allCircles.length;

  // 本地按名称/简介/城市过滤；圈子量级小（store 拉 limit 100），本地过滤足够。
  const circles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCircles;
    return allCircles.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.cities.some((city) => city.toLowerCase().includes(q)),
    );
  }, [allCircles, query]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      searchBar: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      searchInput: { color: colors.text },
      name: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      desc: { color: colors.textSecondary, ...Typography.caption },
      meta: { color: colors.textSecondary, ...Typography.small },
      cover: { backgroundColor: colors.surfaceBorder },
      emptyText: { color: colors.textSecondary, ...Typography.body },
      retryButton: {
        marginTop: Spacing.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.full,
        backgroundColor: colors.primary,
      },
      retryText: {
        color: colors.white,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const handleOpen = useCallback(
    (circle: Circle) => {
      router.push(
        `/(tabs)/discover/circle/${encodeURIComponent(circle.id)}`,
      );
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: Circle }) => (
      <View>
        <Pressable style={s.row} onPress={() => handleOpen(item)}>
          <CircleAvatar
            uri={item.avatarUrl}
            size={48}
            borderRadius={Radius.md}
            style={d.cover}
          />
          <View style={s.info}>
            <Text style={d.name} numberOfLines={1}>
              {item.name}
            </Text>
            {item.description ? (
              <Text style={d.desc} numberOfLines={1}>
                {item.description}
              </Text>
            ) : null}
            <View style={s.metaRow}>
              <Text style={d.meta}>
                {t('discover.memberCount', {
                  count: item.memberCount,
                  defaultValue: '{{count}} 成员',
                })}
              </Text>
              {item.cities.length > 0 ? (
                <Text style={d.meta}>· {item.cities.join('、')}</Text>
              ) : null}
              {!item.isPublic ? (
                <Text style={d.meta}>
                  · {t('discover.needsApproval', { defaultValue: '需申请' })}
                </Text>
              ) : null}
            </View>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
        <Divider />
      </View>
    ),
    [handleOpen, d, colors, t],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('discover.discoverCircles', { defaultValue: '发现圈子' })} />

      <View style={s.searchWrap}>
        <View style={[s.searchBar, d.searchBar]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={[s.searchInput, d.searchInput]}
            value={query}
            onChangeText={setQuery}
            placeholder={t('discover.searchCirclePlaceholder', {
              defaultValue: '搜索圈子名称、城市',
            })}
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={8}
              accessibilityLabel={t('common.clear', { defaultValue: '清除' })}
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {allCirclesLoading && allCircles.length === 0 ? (
        <View style={s.emptyContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : allCirclesError && allCircles.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={d.emptyText}>{allCirclesError}</Text>
          <Pressable style={d.retryButton} onPress={fetchAllCircles}>
            <Text style={d.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={circles}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
        {...keyboardDismissOnDragProps}
          refreshing={refreshing}
          onRefresh={handleRefreshCircles}
          ListHeaderComponent={
            capped ? (
              <View style={s.cappedNotice}>
                <Text style={d.meta}>
                  {t('discover.searchCappedNotice', {
                    count: allCircles.length,
                    defaultValue:
                      '仅展示前 {{count}} 个圈子，搜索请用更精确的关键词',
                  })}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <Text style={d.emptyText}>
                {query.trim()
                  ? t('discover.noCirclesFound', {
                      defaultValue: '没有找到相关圈子',
                    })
                  : t('discover.noCircles')}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
