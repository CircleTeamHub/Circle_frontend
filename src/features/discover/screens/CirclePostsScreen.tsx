import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { PlazaPostCard } from '@/features/discover/components/plaza-post-card';
import { getCircleScopeFromSegments } from '@/features/user/utils/routes';
import { ApiError } from '@/services/api/client';
import { getApiErrorMessage } from '@/services/api/errors';
import { fetchPlazaFeed } from '@/services/api/plaza';
import { Spacing, Typography, useTheme } from '@/theme';
import type { CirclePlazaPost } from '@/types';

const PAGE_SIZE = 20;

const s = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: Spacing.md, gap: Spacing.md, flexGrow: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  footer: { paddingVertical: Spacing.lg },
});

/**
 * 某个圈子里的全部帖子。数据就是广场 feed 按 circleId 过滤:服务端只返回本人是成员的
 * 圈子里、进行中且未过期的帖子,会员门槛与广场同一口径。
 */
export default function CirclePostsScreen() {
  const { id, name } = useLocalSearchParams<{ id?: string; name?: string }>();
  const circleId = typeof id === 'string' ? id : '';
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scope = getCircleScopeFromSegments(useSegments());
  const [posts, setPosts] = useState<CirclePlazaPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [membershipRequired, setMembershipRequired] = useState(false);
  // 下拉刷新会顶掉在途的翻页:只认最后一次发出的请求。
  const requestSeqRef = useRef(0);

  const load = useCallback(
    async (cursor: string | null) => {
      if (!circleId) return;
      const seq = ++requestSeqRef.current;
      setLoading(true);
      try {
        const page = await fetchPlazaFeed({
          circleId,
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        if (seq !== requestSeqRef.current) return;
        setPosts((current) => (cursor ? [...current, ...page.items] : page.items));
        setNextCursor(page.hasMore ? (page.nextCursor ?? null) : null);
        setError(null);
        setMembershipRequired(false);
      } catch (loadError) {
        if (seq !== requestSeqRef.current) return;
        if (loadError instanceof ApiError && loadError.errorCode === 'PLAZA_MEMBERSHIP_REQUIRED') {
          setMembershipRequired(true);
          return;
        }
        setError(loadError);
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [circleId],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void load(null);
  }, [load]);

  const handleEndReached = useCallback(() => {
    if (loading || !nextCursor) return;
    void load(nextCursor);
  }, [load, loading, nextCursor]);

  const handleDeleted = useCallback((postId: string) => {
    setPosts((current) => current.filter((item) => item.id !== postId));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: CirclePlazaPost }) => (
      <PlazaPostCard post={item} onDeleted={handleDeleted} scope={scope} />
    ),
    [handleDeleted, scope],
  );

  // 翻页失败时列表里已有帖子,上面的空态出不来;FlatList 也不会再触发 onEndReached。
  // 在底部给一个按原游标重拉的入口,否则翻页就此卡死、只能下拉从头刷。
  let footer: React.ReactElement | null = null;
  if (loading && posts.length > 0) {
    footer = <ActivityIndicator style={s.footer} color={colors.iconAccent} />;
  } else if (error && posts.length > 0 && nextCursor) {
    footer = (
      <Pressable
        style={s.footer}
        accessibilityRole="button"
        onPress={() => void load(nextCursor)}
      >
        <Text style={{ color: colors.iconAccent, ...Typography.caption, textAlign: 'center' }}>
          {t('discover.loadMorePostsFailed', { defaultValue: '帖子加载失败，点击重试' })}
        </Text>
      </Pressable>
    );
  }

  const mutedText = { color: colors.textSecondary, ...Typography.body };
  let emptyState: React.ReactElement | null = null;
  if (membershipRequired) {
    emptyState = (
      <View style={s.centered}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(tabs)/profile/member-center' as never)}
        >
          <Text style={{ color: colors.iconAccent, ...Typography.body }}>
            {t('serverErrors.PLAZA_MEMBERSHIP_REQUIRED', { defaultValue: '升级会员查看圈子动态' })}
          </Text>
        </Pressable>
      </View>
    );
  } else if (error) {
    emptyState = (
      <View style={s.centered}>
        <Text style={mutedText}>
          {getApiErrorMessage(error, t('discover.loadPostsFailed', { defaultValue: '帖子加载失败，请稍后重试' }))}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void load(null)}>
          <Text style={{ color: colors.iconAccent, ...Typography.body }}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  } else if (loading) {
    emptyState = (
      <View style={s.centered}>
        <ActivityIndicator color={colors.iconAccent} />
      </View>
    );
  } else {
    emptyState = (
      <View style={s.centered}>
        <Text style={mutedText}>
          {t('discover.noActiveActivity', { defaultValue: '暂无进行中的动态' })}
        </Text>
        <Text style={{ color: colors.textSecondary, ...Typography.caption }}>
          {t('discover.endedActivityHiddenHint', { defaultValue: '已结束或过期的动态不会展示在广场' })}
        </Text>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <NavHeader title={name || t('circle.postsTitle', { defaultValue: '圈子帖子' })} />
      <FlatList
        testID="circle-posts-list"
        data={membershipRequired ? [] : posts}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + Spacing.lg }]}
        ListEmptyComponent={emptyState}
        ListFooterComponent={footer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.tabBarActive}
            colors={[colors.tabBarActive]}
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
