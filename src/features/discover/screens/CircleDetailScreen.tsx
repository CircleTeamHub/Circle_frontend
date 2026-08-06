import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  useSegments,
} from 'expo-router';
import {
  getCircleAdminHref,
  getCircleEditHref,
  getCircleInviteHref,
  getCircleScopeFromSegments,
  getInvitationDetailHref,
} from '@/features/user/utils/routes';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { GradientCover } from '@/components/ui/gradient-cover';
import { CircleAvatar } from '@/components/ui/circle-avatar';
import {
  fetchCircleDetail,
  uploadCircleIcon,
  leaveCircle,
  joinCircle,
  fetchMyApplications,
} from '@/services/api/circles';
import { ApiError } from '@/services/api/client';
import { getApiErrorMessage } from '@/services/api/errors';
import { useChangeCircleCover } from '@/features/discover/hooks/use-change-circle-cover';
import { useChangeCircleAvatar } from '@/features/discover/hooks/use-change-circle-avatar';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { ensureCircleConversation } from '@/chat-core/client';
import { shouldOpenChatPreview } from '@/features/chat/chat-preview';
import type { CircleDetail, CircleInvitation } from '@/types';
import { reduceCircleLoadFailure } from '@/features/discover/utils/circle-detail-load-state';

const s = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.lg, paddingBottom: 100 },
  // Header card
  profileCard: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.xl,
    // Tight bottom padding pulls the sections below (圈子图标…) right up.
    paddingBottom: Spacing.xs,
    // Pull the avatar up over the cover, but lower than before so more of the
    // (now taller) cover shows and the avatar sits further down.
    marginTop: -60,
  },
  coverWrap: {
    marginHorizontal: -Spacing.lg,
    height: 240,
  },
  cover: { width: '100%', height: '100%' },
  coverEditBadge: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleName: {
    ...Typography.h2,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.xl,
  },
  statItem: {
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    ...Typography.h3,
  },
  statLabel: {
    ...Typography.caption,
  },
  categoriesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    justifyContent: 'center',
  },
  categoryChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  // Sections
  section: {
    marginTop: Spacing.md,
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: '600',
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
  },
  // Description / Rules
  textBlock: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
  },
  textContent: {
    ...Typography.bodyRegular,
    lineHeight: 21,
  },
  summaryCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
  },
  summaryRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  summaryLabel: {
    ...Typography.body,
    flex: 1,
  },
  summaryValue: {
    ...Typography.caption,
    flexShrink: 1,
    textAlign: 'right',
  },
  // Tags
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  tagChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  // Actions
  actionRow: {
    marginTop: Spacing.xl,
    gap: Spacing.md,
  },
  iconSection: {
    gap: Spacing.sm,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  iconAssetCard: {
    width: 88,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    gap: Spacing.xs,
    alignItems: 'center',
    borderWidth: 1,
  },
  iconAssetPreview: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconAssetImage: {
    width: '100%',
    height: '100%',
  },
  actionBtn: {
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    ...Typography.body,
    fontWeight: '600',
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshError: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  refreshErrorText: {
    ...Typography.caption,
    flex: 1,
  },
  refreshRetryText: {
    ...Typography.caption,
    fontWeight: '600',
  },
});

export default function CircleDetailScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // 本页镜像在 messages/discover 两个栈（聊天圈子名片在本 tab 内打开），
  // 所有内部跳转都要留在当前栈里，做到「从哪进从哪出」。
  const segments = useSegments();
  const circleScope = getCircleScopeFromSegments(segments);

  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [iconSaving, setIconSaving] = useState(false);
  const [enteringGroupChat, setEnteringGroupChat] = useState(false);
  const [joining, setJoining] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlightRef = useRef(false);
  // 首次成功加载后置 true：之后 focus 回本页只做静默刷新，不再进 loading 分支
  //（loading 分支会卸载整个 ScrollView，重挂后滚动位置归零 = 返回跳回顶部）。
  const hasLoadedRef = useRef(false);
  const [myInvitation, setMyInvitation] = useState<CircleInvitation | null>(
    null,
  );
  const mountedRef = useRef(true);
  const circleRequestRef = useRef(0);
  const invitationRequestRef = useRef(0);

  // 进入圈子群聊：先解析出会话 ID（否则聊天页拿不到 conversationID 会停在预览模式），
  // 再入 discover 栈，返回时回到圈子详情。
  const handleEnterGroupChat = useCallback(async () => {
    const groupID = circle?.groupID;
    if (!groupID || enteringGroupChat) return;
    try {
      setEnteringGroupChat(true);
      const conversation = await ensureCircleConversation(groupID);
      router.push({
        pathname:
          circleScope === 'messages'
            ? '/(tabs)/messages/chat-detail'
            : '/(tabs)/discover/chat-detail',
        params: {
          conversationID: conversation.conversationID,
          sourceID: groupID,
          conversationType: 'group',
          title: circle?.name ?? '',
        },
      });
    } catch (error) {
      if (shouldOpenChatPreview(error)) {
        // IM 未接通：退化成预览模式（无 conversationID）。
        router.push({
          pathname:
          circleScope === 'messages'
            ? '/(tabs)/messages/chat-detail'
            : '/(tabs)/discover/chat-detail',
          params: {
            sourceID: groupID,
            conversationType: 'group',
            title: circle?.name ?? '',
          },
        });
        return;
      }
      Alert.alert(t('circle.error'), t('common.networkError'));
    } finally {
      if (mountedRef.current) setEnteringGroupChat(false);
    }
  }, [circle?.groupID, circle?.name, circleScope, enteringGroupChat, router, t]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCircle = useCallback(async (options?: { showInitialLoading?: boolean }) => {
    if (!id) {
      if (mountedRef.current) setLoading(false);
      return;
    }

    const requestId = ++circleRequestRef.current;
    const showInitialLoading = options?.showInitialLoading ?? true;
    if (showInitialLoading) setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchCircleDetail(id);
      if (!mountedRef.current || requestId !== circleRequestRef.current) return;
      setCircle(data);
      hasLoadedRef.current = true;
    } catch (error) {
      if (!mountedRef.current || requestId !== circleRequestRef.current) return;
      const isNotFound = error instanceof ApiError && error.status === 404;
      setLoadError(
        isNotFound ? null : getApiErrorMessage(error, t('circle.loadError')),
      );
      setCircle((current) => {
        const result = reduceCircleLoadFailure({
          circle: current,
          hasLoaded: hasLoadedRef.current,
          isLatestRequest: requestId === circleRequestRef.current,
          isNotFound,
        });
        hasLoadedRef.current = result.hasLoaded;
        return result.circle;
      });
    } finally {
      if (
        mountedRef.current &&
        requestId === circleRequestRef.current &&
        showInitialLoading
      ) {
        setLoading(false);
      }
    }
  }, [id, t]);

  // 当前用户在该圈是否有进行中的入圈申请（10 人担保验证）。有则在底部给出
  // 「邀请好友为我验证」入口——invitation 流程的接收侧本来没有前端入口。
  const loadMyInvitation = useCallback(async () => {
    const requestId = ++invitationRequestRef.current;
    setMyInvitation(null);
    if (!id) return;
    try {
      const apps = await fetchMyApplications();
      if (!mountedRef.current || requestId !== invitationRequestRef.current) {
        return;
      }
      setMyInvitation(
        apps.find((inv) => inv.circleId === id && inv.status === 'PENDING') ??
          null,
      );
    } catch {
      // 非关键路径，失败不阻塞详情页展示
      if (mountedRef.current && requestId === invitationRequestRef.current) {
        setMyInvitation(null);
      }
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      // 从子页面（入圈审核/邀请等）返回时静默刷新，保住滚动位置；
      // 只有首次进入（或首载失败后）才显示整页 loading。
      void loadCircle({ showInitialLoading: !hasLoadedRef.current });
      void loadMyInvitation();
    }, [loadCircle, loadMyInvitation]),
  );

  const handleRefreshCircle = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([
        loadCircle({ showInitialLoading: false }),
        loadMyInvitation(),
      ]);
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [loadCircle, loadMyInvitation]);

  const isOwner = circle?.myRole === 'OWNER';
  const isOwnerOrAdmin = isOwner || circle?.myRole === 'ADMIN';
  const isActiveMember = circle?.myStatus === 'ACTIVE';

  const { changeCover: changeCircleCover } = useChangeCircleCover(id, (url) => {
    setCircle((current) => (current ? { ...current, cover: url } : current));
    // Keep the cached circle lists in sync so they don't show a stale image.
    useCirclesStore.getState().patchCircle(id, { cover: url });
  });

  const { changeAvatar: changeCircleAvatar } = useChangeCircleAvatar(
    id,
    (url) => {
      setCircle((current) =>
        current ? { ...current, avatarUrl: url } : current,
      );
      useCirclesStore.getState().patchCircle(id, { avatarUrl: url });
    },
  );

  // Active members who are not the owner can leave. Owners must transfer or
  // dissolve the circle instead, so they never see the leave action.
  const canLeaveCircle =
    circle?.myStatus === 'ACTIVE' && circle?.myRole !== 'OWNER';

  const handleJoinCircle = useCallback(async () => {
    if (!id || joining) return;
    setJoining(true);
    try {
      await joinCircle(id);
      // round 3 review：成员关系已变 —— 变更前出发的 /circle/my 在飞快照
      // 必须作废（force 绕过在飞合并），否则返回广场的 focus 刷新会 await
      // 到入圈前的列表。fire-and-forget，不阻塞本页刷新。
      void useCirclesStore.getState().fetchMyCircles({ force: true });
      await loadCircle();
    } catch (error) {
      Alert.alert(
        t('circle.joinFailedTitle', { defaultValue: '加入失败' }),
        getApiErrorMessage(
          error,
          t('common.retryLater', { defaultValue: '请稍后重试' }),
        ),
      );
    } finally {
      setJoining(false);
    }
  }, [id, joining, loadCircle, t]);

  const handleLeaveCircle = useCallback(() => {
    if (!id) return;
    Alert.alert(
      t('circle.leaveTitle', { defaultValue: '退出圈子' }),
      t('circle.leaveMessage', { defaultValue: '确定退出该圈子吗？' }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('circle.leaveConfirm', { defaultValue: '退出' }),
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveCircle(id);
              useCirclesStore.getState().removeCircle(id);
              router.back();
            } catch (error) {
              Alert.alert(
                t('circle.leaveFailedTitle', { defaultValue: '退出失败' }),
                getApiErrorMessage(
                  error,
                  t('common.retryLater', { defaultValue: '请稍后重试' }),
                ),
              );
            }
          },
        },
      ],
    );
  }, [id, router, t]);

  const handleUploadCircleIcon = useCallback(async () => {
    if (!id || !isOwnerOrAdmin || iconSaving) {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (result.canceled || !result.assets.length) {
      return;
    }

    const asset = result.assets[0];
    const contentType = resolveUploadContentType({
      mimeType: asset.mimeType,
      fileName: asset.fileName,
    });

    if (!contentType || !asset.uri) {
      Alert.alert(
        t('circle.error'),
        t('circle.icon.unknownImageFormat', {
          defaultValue: '无法识别图片格式',
        }),
      );
      return;
    }

    try {
      setIconSaving(true);
      const presign = await requestUploadPresign({
        filename: sanitizeUploadFilename(asset.fileName ?? 'circle-icon.jpg'),
        contentType,
        folder: 'avatars',
      });
      await uploadLocalFileToPresignedUrl(presign.uploadUrl, contentType, asset.uri);
      await uploadCircleIcon(id, {
        imageUrl: presign.fileUrl,
        name: circle?.name ? `${circle.name}-icon` : 'circle-icon',
      });
      if (mountedRef.current) {
        await loadCircle();
      }
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert(
          t('circle.error'),
          error instanceof Error ? error.message : t('circle.loadError'),
        );
      }
    } finally {
      if (mountedRef.current) {
        setIconSaving(false);
      }
    }
  }, [circle?.name, iconSaving, id, isOwnerOrAdmin, loadCircle, t]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      circleName: { color: colors.text },
      statValue: { color: colors.text },
      statLabel: { color: colors.textSecondary },
      sectionTitle: { color: colors.textSecondary },
      sectionCard: { backgroundColor: colors.surface },
      textContent: { color: colors.text },
      textPlaceholder: { color: colors.textSecondary },
      summaryLabel: { color: colors.text },
      summaryValue: { color: colors.textSecondary },
      categoryChip: { backgroundColor: colors.primary },
      categoryText: { color: colors.white, ...Typography.caption },
      tagChip: { backgroundColor: colors.primary },
      tagText: { color: colors.white, ...Typography.caption },
      avatarEditBadge: { backgroundColor: colors.primary },
      coverEditBadge: { backgroundColor: 'rgba(0,0,0,0.45)' },
      chatBtn: { backgroundColor: colors.primary },
      chatBtnText: { color: colors.white },
      adminBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
      adminBtnText: { color: colors.text },
      dangerBtn: { backgroundColor: colors.error },
      dangerBtnText: { color: colors.white },
      refreshError: { backgroundColor: colors.surface },
      refreshErrorText: { color: colors.textSecondary },
      refreshRetryText: { color: colors.primary },
      iconAssetCard: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
    }),
    [colors],
  );

  if (loading) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('circle.detail')} />
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!circle) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('circle.detail')} />
        <View style={s.centerLoader}>
          <Text style={{ color: colors.textSecondary }}>
            {loadError ?? t('circle.notExist')}
          </Text>
          {loadError ? (
            <Pressable
              onPress={() => void loadCircle()}
              style={{ marginTop: Spacing.md }}
            >
              <Text style={d.refreshRetryText}>{t('common.retry')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('circle.detail')}
        rightIcon={isOwnerOrAdmin ? 'create-outline' : undefined}
        onRightPress={
          isOwnerOrAdmin
            ? () =>
                router.push(getCircleEditHref(circleScope, circle.id))
            : undefined
        }
      />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefreshCircle}
            tintColor={colors.primary}
          />
        }
      >
        {loadError && circle ? (
          <View style={[s.refreshError, d.refreshError]}>
            <Text style={[s.refreshErrorText, d.refreshErrorText]}>
              {loadError}
            </Text>
            <Pressable
              onPress={() =>
                void loadCircle({ showInitialLoading: false })
              }
            >
              <Text style={[s.refreshRetryText, d.refreshRetryText]}>
                {t('common.retry')}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {/* ── Cover banner ── */}
        <Pressable
          style={s.coverWrap}
          onPress={isOwner ? changeCircleCover : undefined}
          disabled={!isOwner}
        >
          {circle.cover ? (
            <Image
              source={{ uri: circle.cover }}
              style={s.cover}
              contentFit="cover"
            />
          ) : (
            <View style={s.cover}>
              <GradientCover />
            </View>
          )}
          {isOwner ? (
            <View style={[s.coverEditBadge, d.coverEditBadge]}>
              <Ionicons name="camera" size={12} color={colors.white} />
              <Text style={{ color: colors.white, ...Typography.tiny }}>
                {t('circle.changeCover', { defaultValue: '换封面' })}
              </Text>
            </View>
          ) : null}
        </Pressable>

        {/* ── Profile Card ── */}
        <View style={s.profileCard}>
          {/* Avatar */}
          <Pressable
            style={s.avatarWrap}
            onPress={isOwner ? changeCircleAvatar : undefined}
            disabled={!isOwner}
          >
            <CircleAvatar
              uri={circle.avatarUrl}
              size={80}
              borderRadius={Radius.xl}
            />
            {isOwner ? (
              <View style={[s.avatarEditBadge, d.avatarEditBadge]}>
                <Ionicons name="camera" size={12} color={colors.white} />
              </View>
            ) : null}
          </Pressable>

          {/* Name */}
          <Text style={[s.circleName, d.circleName]}>{circle.name}</Text>

          {/* Categories */}
          {circle.categories.length > 0 ? (
            <View style={s.categoriesRow}>
              {circle.categories.map((c) => (
                <View key={c} style={[s.categoryChip, d.categoryChip]}>
                  <Text style={d.categoryText}>{c}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Stats */}
          <View style={s.statsRow}>
            <View style={s.statItem}>
              <Text style={[s.statValue, d.statValue]}>{circle.memberCount}</Text>
              <Text style={[s.statLabel, d.statLabel]}>{t('circle.members')}</Text>
            </View>
            <View style={s.statItem}>
              <Text style={[s.statValue, d.statValue]}>{circle.postCount}</Text>
              <Text style={[s.statLabel, d.statLabel]}>{t('circle.posts')}</Text>
            </View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>
            {t('circle.icon.sectionTitle', { defaultValue: '圈子图标' })}
          </Text>
          <View style={s.iconSection}>
            <View style={s.iconGrid}>
              {circle.currentIconUrl ? (
                <View style={[s.iconAssetCard, d.iconAssetCard]}>
                  <View style={s.iconAssetPreview}>
                    <Image source={{ uri: circle.currentIconUrl }} style={s.iconAssetImage} contentFit="cover" />
                  </View>
                  <Text style={{ color: colors.text }}>
                    {t('circle.icon.current', { defaultValue: '当前图标' })}
                  </Text>
                </View>
              ) : null}
            </View>
            {isOwnerOrAdmin ? (
              <Pressable
                style={[s.actionBtn, d.adminBtn]}
                onPress={handleUploadCircleIcon}
                disabled={iconSaving}
              >
                <Text style={d.adminBtnText}>
                  {iconSaving
                    ? t('circle.icon.uploading', { defaultValue: '上传中...' })
                    : t('circle.icon.upload', { defaultValue: '上传圈子图标' })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* ── 圈子描述 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.description')}</Text>
          <View style={[s.textBlock, d.sectionCard]}>
            <Text style={[s.textContent, circle.description ? d.textContent : d.textPlaceholder]}>
              {circle.description || t('circle.noDescription')}
            </Text>
          </View>
        </View>

        {/* ── 圈子公告与规则 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.rules')}</Text>
          <View style={[s.textBlock, d.sectionCard]}>
            <Text style={[s.textContent, circle.rules ? d.textContent : d.textPlaceholder]}>
              {circle.rules || t('circle.noRules')}
            </Text>
          </View>
        </View>

        {/* ── 标签 ── */}
        {circle.tags.length > 0 ? (
          <View style={s.section}>
            <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.tagsLabel')}</Text>
            <View style={s.tagsRow}>
              {circle.tags.map((tag) => (
                <View key={tag} style={[s.tagChip, d.tagChip]}>
                  <Text style={d.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── 入圈规则摘要 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.rulesSummary')}</Text>
          <View style={[s.summaryCard, d.sectionCard]}>
            {[
              {
                key: 'cities',
                label: t('circle.relatedCities'),
                value:
                  circle.cities.length > 0
                    ? circle.cities.join('、')
                    : t('common.nationwide'),
              },
              {
                key: 'vip',
                label: t('circle.joinVipRestriction'),
                value:
                  circle.joinVipRestriction != null
                    ? `VIP${circle.joinVipRestriction}+`
                    : t('common.noRestriction'),
              },
              {
                key: 'credit',
                label: t('circle.joinCreditRestriction'),
                value:
                  circle.joinCreditRestriction != null
                    ? t('circle.creditSuffix', {
                        score: circle.joinCreditRestriction,
                      })
                    : t('common.noRestriction'),
              },
              {
                key: 'fancy',
                label: t('circle.fancyRequired'),
                value: circle.joinFancyRestriction
                  ? t('common.yes')
                  : t('common.no'),
              },
              {
                key: 'memberCanPost',
                label: t('circle.memberCanPost'),
                value: circle.memberCanPost
                  ? t('circle.allowed')
                  : t('circle.adminOnly'),
              },
            ].map((row, index, rows) => (
              <View key={row.key}>
                <View style={s.summaryRow}>
                  <Text style={[s.summaryLabel, d.summaryLabel]}>
                    {row.label}
                  </Text>
                  <Text style={[s.summaryValue, d.summaryValue]}>
                    {row.value}
                  </Text>
                </View>
                {index < rows.length - 1 ? <Divider /> : null}
              </View>
            ))}
          </View>
        </View>

        {/* ── Actions ── */}
        <View style={s.actionRow}>
          {/* 加入圈子 (non-members) */}
          {!isActiveMember ? (
            circle.myStatus === 'PENDING' ? (
              myInvitation ? (
                <Pressable
                  style={[s.actionBtn, d.chatBtn]}
                  onPress={() =>
                    router.push(
                      getInvitationDetailHref(circleScope, myInvitation.id),
                    )
                  }
                >
                  <Text style={[s.actionBtnText, d.chatBtnText]}>
                    {t('circle.inviteVerifiers', {
                      approved: myInvitation.approvedCount,
                      required: myInvitation.requiredCount,
                      defaultValue:
                        '邀请好友为我验证 ({{approved}}/{{required}})',
                    })}
                  </Text>
                </Pressable>
              ) : (
                <Pressable style={[s.actionBtn, d.adminBtn]} disabled>
                  <Text style={[s.actionBtnText, d.adminBtnText]}>
                    {t('circle.joinPending', { defaultValue: '审核中' })}
                  </Text>
                </Pressable>
              )
            ) : (
              <Pressable
                style={[s.actionBtn, d.chatBtn]}
                onPress={handleJoinCircle}
                disabled={joining}
              >
                <Text style={[s.actionBtnText, d.chatBtnText]}>
                  {joining
                    ? t('common.processing', { defaultValue: '处理中' })
                    : t('circle.join', { defaultValue: '加入圈子' })}
                </Text>
              </Pressable>
            )
          ) : null}

          {/* 进入群聊 */}
          {isActiveMember && circle.groupID ? (
            <Pressable
              style={[s.actionBtn, d.chatBtn]}
              onPress={handleEnterGroupChat}
              disabled={enteringGroupChat}
            >
              <Text style={[s.actionBtnText, d.chatBtnText]}>{t('circle.enterGroupChat')}</Text>
            </Pressable>
          ) : null}

          {/* 邀请好友 (active members) — 菜单里"发送圈子名片"对活跃成员开放、
              "邀请通讯录好友"只对 owner/admin；myRole 透传给菜单做区分。
              review R3：入口回到 isActiveMember，别把不读目录的名片分享也锁死。 */}
          {isActiveMember ? (
            <Pressable
              style={[s.actionBtn, d.chatBtn]}
              onPress={() =>
                router.push(
                  getCircleInviteHref(
                    circleScope,
                    circle.id,
                    circle.name,
                    circle.avatarUrl ?? '',
                    circle.myRole,
                  ),
                )
              }
            >
              <Text style={[s.actionBtnText, d.chatBtnText]}>
                {t('circle.invite.entry', { defaultValue: '邀请好友' })}
              </Text>
            </Pressable>
          ) : null}

          {/* 入圈审核 (admin only) */}
          {isOwnerOrAdmin ? (
            <Pressable
              style={[s.actionBtn, d.adminBtn]}
              onPress={() =>
                router.push(getCircleAdminHref(circleScope, circle.id))
              }
            >
              <Text style={[s.actionBtnText, d.adminBtnText]}>{t('circle.adminReview')}</Text>
            </Pressable>
          ) : null}

          {/* 退出圈子 (active non-owner members) */}
          {canLeaveCircle ? (
            <Pressable
              style={[s.actionBtn, d.dangerBtn]}
              onPress={handleLeaveCircle}
            >
              <Text style={[s.actionBtnText, d.dangerBtnText]}>
                {t('circle.leave', { defaultValue: '退出圈子' })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
