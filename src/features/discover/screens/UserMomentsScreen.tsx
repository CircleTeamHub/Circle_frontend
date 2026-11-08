import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
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
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  useSegments,
  type Href,
} from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import {
  getMomentDetailHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import { useTranslation } from 'react-i18next';
import { Spacing, Typography, useTheme } from '@/theme';
import { fetchUserProfile } from '@/services/api/profile';
import { ApiError, isDefinitiveAuthFailure } from '@/services/api/client';
import { momentsMutatedSince } from '@/services/api/moments';
import { getPageSnapshotRevision } from '@/storage/page-snapshots';
import { getApiErrorMessage } from '@/services/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { useUserMoments } from '@/features/discover/hooks/use-user-moments';
import { useChangeCover } from '@/features/discover/hooks/use-change-cover';
import { isSameCalendarDay } from '@/features/discover/utils/album-date';
import { MomentAlbumHeader } from '@/features/discover/components/moment-album-header';
import { MomentAlbumRow } from '@/features/discover/components/moment-album-row';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { getProfileSignature } from '@/features/profile/profile-display';
import type { MomentPost } from '@/types';
import { evictUserProfileCache, isProfileCacheFresh, readUserProfileCache, writeUserProfileCache } from '@/features/user/profile-cache';
import { reportHandledFailure } from '@/observability/report-failure';
import { usePullRefresh } from '@/hooks/use-pull-refresh';

const s = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: 80 },
  emptyContainer: { alignItems: 'center', paddingTop: 80, gap: Spacing.md },
  footerLoader: { paddingVertical: Spacing.lg, alignItems: 'center' },
});

const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList,
) as unknown as ComponentType<AnimatedProps<FlatListProps<MomentPost>>>;

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value?.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    ),
  );
}

export default function UserMomentsScreen() {
  const { t } = useTranslation();
  // 不把翻译函数身份放进资料请求 effect：资源初始化/切换语言时 t 可能变化，
  // 但同一个 route 不应因此再次请求资料和朋友圈。
  const translateRef = useRef(t);
  translateRef.current = t;
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const fallbackHref = { pathname: `/(tabs)/${scope}` } as Href;
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const routeUserId = typeof params.id === 'string' ? params.id : '';
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const currentUser = useAuthStore((state) => state.user);
  const initialCache = readUserProfileCache(sessionEpoch, routeUserId);
  const ownProfile = currentUser?.id === routeUserId ? currentUser : null;
  const [canonicalUserId, setCanonicalUserId] = useState(() =>
    initialCache?.album?.value.id ?? initialCache?.profile?.value.id ?? (isUuid(routeUserId) ? routeUserId : ''),
  );
  const currentUserId = useAuthStore((state) => state.user?.id);
  const isOwn = !!currentUserId && currentUserId === canonicalUserId;

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const { moments, loading, hasMore, error, lastLoadedAt, refresh, loadMore } =
    useUserMoments(canonicalUserId);
  // 发完 / 删完动态回来的自动重拉不能驱动下拉刷新控件,见 usePullRefresh。
  const pull = usePullRefresh(refresh);

  useFocusEffect(useCallback(() => {
    if (lastLoadedAt != null && momentsMutatedSince(lastLoadedAt)) void refresh();
  }, [lastLoadedAt, refresh]));

  const [cover, setCover] = useState<string | null>(() => ownProfile?.cover ?? initialCache?.album?.value.cover ?? null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => ownProfile?.avatarUrl ?? initialCache?.album?.value.avatarUrl ?? initialCache?.profile?.value.avatarUrl ?? null);
  const [nickname, setNickname] = useState<string>(() => ownProfile?.nickname ?? initialCache?.album?.value.nickname ?? initialCache?.profile?.value.name ?? params.name ?? '');
  const [signature, setSignature] = useState(() => ownProfile ? getProfileSignature(ownProfile.persona, ownProfile.helloWords) : initialCache?.album?.value.signature ?? initialCache?.profile?.value.signature ?? '');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileResolving, setProfileResolving] = useState(false);

  const { changeCover, cropper: coverCropper } = useChangeCover(canonicalUserId, setCover);

  useEffect(() => {
    let active = true;
    const cached = readUserProfileCache(sessionEpoch, routeUserId);
    const own = useAuthStore.getState().user;
    const ownAlbum = own?.id === routeUserId ? own : null;
    setCanonicalUserId(ownAlbum?.id ?? cached?.album?.value.id ?? cached?.profile?.value.id ?? (isUuid(routeUserId) ? routeUserId : ''));
    setCover(ownAlbum?.cover ?? cached?.album?.value.cover ?? null);
    setAvatarUrl(ownAlbum?.avatarUrl ?? cached?.album?.value.avatarUrl ?? cached?.profile?.value.avatarUrl ?? null);
    setNickname(ownAlbum?.nickname ?? cached?.album?.value.nickname ?? cached?.profile?.value.name ?? params.name ?? '');
    setSignature(ownAlbum ? getProfileSignature(ownAlbum.persona, ownAlbum.helloWords) : cached?.album?.value.signature ?? cached?.profile?.value.signature ?? '');
    setProfileError(null);
    setProfileResolving(Boolean(routeUserId));

    if (!routeUserId) {
      setProfileResolving(false);
      setProfileError(translateRef.current('common.networkError'));
      return () => {
        active = false;
      };
    }

    if (ownAlbum || isProfileCacheFresh(cached?.album, Date.now(), () => false)) {
      setProfileResolving(false);
      return () => { active = false; };
    }
    const startedAt = Date.now();
    const requestRevision = getPageSnapshotRevision();
    void (async () => {
      try {
        const profile = await fetchUserProfile(routeUserId);
        if (!active || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
        writeUserProfileCache(sessionEpoch, routeUserId, { album: { value: { id: profile.id, nickname: profile.nickname, avatarUrl: profile.avatarUrl, cover: profile.cover, signature: getProfileSignature(profile.persona, profile.helloWords) }, at: startedAt } }, requestRevision);
        setCanonicalUserId(profile.id);
        setCover(profile.cover);
        setAvatarUrl(profile.avatarUrl);
        if (profile.nickname) setNickname(profile.nickname);
        setSignature(
          getProfileSignature(profile.persona, profile.helloWords),
        );
      } catch (err) {
        if (!active || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
        if (isDefinitiveAuthFailure(err) || (err instanceof ApiError && err.status === 404)) {
          evictUserProfileCache(sessionEpoch, routeUserId);
          setCover(null);
          setAvatarUrl(null);
          setNickname(params.name ?? '');
          setSignature('');
        }
        setProfileError(
          getApiErrorMessage(
            err,
            translateRef.current('common.networkError'),
          ),
        );
        reportHandledFailure('userProfile', 'fetchProfile', err);
      } finally {
        if (active) setProfileResolving(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [params.name, routeUserId, sessionEpoch]);

  const title = nickname
    ? t('moment.albumTitle', { name: nickname })
    : t('moment.albumTitleFallback');

  const handlePress = useCallback(
    (postId: string) => {
      router.push(getMomentDetailHref(scope, postId));
    },
    [router, scope],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: MomentPost; index: number }) => {
      const showDate =
        index === 0 ||
        !isSameCalendarDay(moments[index - 1].createdAt, item.createdAt);
      return (
        <MomentAlbumRow
          post={item}
          showDate={showDate}
          onPress={handlePress}
          testID={E2E_TEST_IDS.momentOwnRow(item.id)}
        />
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
      signature={signature}
      onPressCover={isOwn ? changeCover : undefined}
      scrollY={scrollY}
    />
  );

  const ListEmpty = !loading && !profileResolving ? (
    <View style={s.emptyContainer}>
      <Text style={{ color: colors.textSecondary, ...Typography.body }}>
        {profileError ?? error ?? t('discover.noMoments')}
      </Text>
    </View>
  ) : null;

  const ListFooter =
    loading && moments.length > 0 ? (
      <View style={s.footerLoader}>
        <ActivityIndicator color={colors.iconAccent} />
      </View>
    ) : null;

  const handleEndReached = useCallback(() => {
    // loadMore tracks pagination failures separately, so a refresh error must
    // not block a still-valid next cursor from the last successful page.
    if (!loading && hasMore) {
      void loadMore();
    }
  }, [loading, hasMore, loadMore]);

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <View style={{ paddingTop: insets.top }}>
        <NavHeader title={title} fallbackHref={fallbackHref} />
      </View>
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
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.tabBarActive}
            colors={[colors.tabBarActive]}
          />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={40}
        windowSize={9}
        removeClippedSubviews={Platform.OS === 'android'}
        showsVerticalScrollIndicator={false}
      />
      {coverCropper}
    </View>
  );
}
