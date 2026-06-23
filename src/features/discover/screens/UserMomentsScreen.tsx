import { useCallback, useEffect, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type FlatListProps,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  type AnimatedProps,
} from 'react-native-reanimated';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Spacing, Typography, useTheme } from '@/theme';
import { fetchUserProfile } from '@/services/api/profile';
import { useAuthStore } from '@/stores/authStore';
import { useUserMoments } from '@/features/discover/hooks/use-user-moments';
import { useChangeCover } from '@/features/discover/hooks/use-change-cover';
import { isSameCalendarDay } from '@/features/discover/utils/album-date';
import { MomentAlbumHeader } from '@/features/discover/components/moment-album-header';
import { MomentAlbumRow } from '@/features/discover/components/moment-album-row';
import type { MomentPost } from '@/types';

const s = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: 80 },
  emptyContainer: { alignItems: 'center', paddingTop: 80, gap: Spacing.md },
  footerLoader: { paddingVertical: Spacing.lg, alignItems: 'center' },
});

const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList,
) as unknown as ComponentType<AnimatedProps<FlatListProps<MomentPost>>>;

export default function UserMomentsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const userId = params.id;
  const currentUserId = useAuthStore((state) => state.user?.id);
  const isOwn = !!currentUserId && currentUserId === userId;

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const { moments, loading, refreshing, hasMore, error, refresh, loadMore } =
    useUserMoments(userId);

  const [cover, setCover] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string>(params.name ?? '');

  const { changeCover } = useChangeCover(userId, setCover);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const profile = await fetchUserProfile(userId);
        if (!active) return;
        setCover(profile.cover);
        setAvatarUrl(profile.avatarUrl);
        if (profile.nickname) setNickname(profile.nickname);
      } catch (err) {
        if (__DEV__) {
          console.warn('[UserMomentsScreen] fetchUserProfile failed', err);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const title = nickname
    ? t('moment.albumTitle', { name: nickname })
    : t('moment.albumTitleFallback');

  const handlePress = useCallback(
    (postId: string) => {
      router.push({
        pathname: '/(tabs)/discover/moment/[id]',
        params: { id: postId },
      });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: MomentPost; index: number }) => {
      const showDate =
        index === 0 ||
        !isSameCalendarDay(moments[index - 1].createdAt, item.createdAt);
      return (
        <MomentAlbumRow post={item} showDate={showDate} onPress={handlePress} />
      );
    },
    [moments, handlePress],
  );

  const keyExtractor = useCallback((item: MomentPost) => item.id, []);

  const ListHeader = (
    <MomentAlbumHeader
      coverUrl={cover}
      avatarUrl={avatarUrl}
      nickname={nickname || title}
      onPressCover={isOwn ? changeCover : undefined}
      scrollY={scrollY}
    />
  );

  const ListEmpty = !loading ? (
    <View style={s.emptyContainer}>
      <Text style={{ color: colors.textSecondary, ...Typography.body }}>
        {error ?? t('discover.noMoments')}
      </Text>
    </View>
  ) : null;

  const ListFooter =
    loading && moments.length > 0 ? (
      <View style={s.footerLoader}>
        <ActivityIndicator color={colors.primary} />
      </View>
    ) : null;

  const handleEndReached = useCallback(() => {
    if (!loading && hasMore) {
      void loadMore();
    }
  }, [loading, hasMore, loadMore]);

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{ title, headerTransparent: true, headerTitle: '' }}
      />
      <AnimatedFlatList
        data={moments}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={s.listContent}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
