import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
import { Divider } from '@/components/ui/divider';
import { UserIconRow } from '@/components/ui/user-icon-row';
import { Spacing, useTheme } from '@/theme';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import {
  fetchMyPostSignups,
  fetchPlazaPost,
  markMyPostSignupsRead,
  submitPostCollaborationRecognitions,
} from '@/services/api/plaza';
import { getApiErrorMessage } from '@/services/api/errors';
import { ensureDirectConversation } from '@/chat-core/client';
import { usePendingChatCardStore } from '@/features/chat/store/use-pending-chat-card-store';
import { toPlazaPostCardData } from '@/features/discover/utils/plaza-post-card';
import {
  getChatDetailHref,
  getUserProfileHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { markMatchingTargetNotificationsRead } from '@/features/notifications/utils/seen-target';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import type { CirclePlazaPost, PlazaPostCardData, PostSignupItem } from '@/types';
import { reportHandledFailure } from '@/observability/report-failure';

export default function PostSignupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const { colors } = useTheme();
  const { t } = useTranslation();
  const mountedRef = useRef(true);
  const openingChatRef = useRef(false);
  const { postId, title } = useLocalSearchParams<{
    postId: string;
    title?: string;
  }>();

  const [signups, setSignups] = useState<PostSignupItem[]>([]);
  // 拉一次帖子，供「找 TA 聊天」构造帖子卡片（报名→聊天自动带上下文）。
  const [post, setPost] = useState<CirclePlazaPost | null>(null);
  const setPendingChatCard = usePendingChatCardStore((s) => s.setPending);
  const [recognitionOpen, setRecognitionOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecognitionIds, setSelectedRecognitionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [recognitionSubmitting, setRecognitionSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!postId) return;
    fetchPlazaPost(postId)
      .then((data) => {
        if (mountedRef.current) setPost(data);
      })
      .catch(() => {
        // 帖子卡片是锦上添花——拉不到就退化成纯开场白，不打断聊天入口。
      });
  }, [postId]);

  const buildPostCard = useCallback(
    (p: CirclePlazaPost): PlazaPostCardData =>
      toPlazaPostCardData(
        p,
        t('plaza.signup.cardUntitled', { defaultValue: '活动分享' }),
      ),
    [t],
  );

  const load = useCallback(async () => {
    if (!postId) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      const { items, recognitionOpen: open } = await fetchMyPostSignups(postId);
      if (!mountedRef.current) return;
      setSignups(items);
      setRecognitionOpen(open);
      const unreadCount = items.filter((item) => !item.seen).length;
      if (unreadCount > 0) {
        try {
          await markMyPostSignupsRead(postId);
          if (!mountedRef.current) return;
          useNotificationCenterStore
            .getState()
            .markPostSignupsSeenLocal(postId);
          const badgeStore = useTabBadgeStore.getState();
          badgeStore.setSignupUnread(
            Math.max(0, badgeStore.signupUnread - unreadCount),
          );
        } catch (error) {
          reportHandledFailure('postSignups', 'markRead', error);
        }
      }
    } catch (error) {
      reportHandledFailure('postSignups', 'load', error);
      if (mountedRef.current) {
        setLoadError(
          t('notifications.signupMgmt.loadFailed', {
            defaultValue: '报名列表加载失败，请重试',
          }),
        );
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [postId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void markMatchingTargetNotificationsRead({ circlePostId: postId });
  }, [postId]);

  const [openingChatFor, setOpeningChatFor] = useState<string | null>(null);

  useEffect(() => {
    setSearchQuery('');
    setSelectedRecognitionIds(new Set());
  }, [postId]);

  const filteredSignups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return signups;
    return signups.filter((item) => {
      const nickname = item.nickname.toLowerCase();
      const accountId = item.accountId.toLowerCase();
      return nickname.includes(query) || accountId.includes(query);
    });
  }, [searchQuery, signups]);

  // 已被认可的人数（后端 recognized 字段，刷新后仍准确）。每个帖子总额度 3 人，
  // 已认可的也计入额度，所以本次还能选的名额是 3 - 已认可数。
  const RECOGNITION_LIMIT = 3;
  const alreadyRecognizedCount = useMemo(
    () => signups.filter((item) => item.recognized).length,
    [signups],
  );
  const remainingSlots = Math.max(0, RECOGNITION_LIMIT - alreadyRecognizedCount);
  // 名额用尽（已认可满 3 人）时彻底锁面板；活动未开放认可由后端 recognitionOpen 控制。
  const recognitionLocked = remainingSlots === 0;

  const toggleRecognitionSelection = useCallback(
    (item: PostSignupItem) => {
      if (recognitionSubmitting || recognitionLocked || item.recognized) return;
      setSelectedRecognitionIds((current) => {
        const next = new Set(current);
        if (next.has(item.userId)) {
          next.delete(item.userId);
          return next;
        }
        if (current.size >= remainingSlots) {
          Alert.alert(
            t('notifications.signupMgmt.recognitionLimitTitle', {
              defaultValue: '最多选择 3 人',
            }),
            t('notifications.signupMgmt.recognitionLimitMessage', {
              defaultValue: '每个活动最多给 3 位报名者合作认可。',
            }),
          );
          return current;
        }
        next.add(item.userId);
        return next;
      });
    },
    [recognitionSubmitting, recognitionLocked, remainingSlots, t],
  );

  const submitRecognitions = useCallback(async () => {
    if (!postId || selectedRecognitionIds.size === 0 || recognitionSubmitting) {
      return;
    }
    setRecognitionSubmitting(true);
    const recipientIds = Array.from(selectedRecognitionIds);
    try {
      const result = await submitPostCollaborationRecognitions(postId, recipientIds);
      if (!mountedRef.current) return;
      setSelectedRecognitionIds(new Set());
      Alert.alert(
        t('notifications.signupMgmt.recognitionSuccessTitle', {
          defaultValue: '已提交合作认可',
        }),
        t('notifications.signupMgmt.recognitionSuccessMessage', {
          count: result.count,
          defaultValue: `已认可 ${result.count} 位报名者。`,
        }),
      );
      // 重新拉取，让 recognized 标记成为「已提交」的唯一真相，刷新/重进都不会丢、也无法重复提交。
      void load();
    } catch (error) {
      if (!mountedRef.current) return;
      Alert.alert(
        t('notifications.signupMgmt.recognitionFailedTitle', {
          defaultValue: '提交失败',
        }),
        getApiErrorMessage(
          error,
          t('common.networkError', { defaultValue: '网络错误，请重试' }),
        ),
      );
    } finally {
      if (mountedRef.current) setRecognitionSubmitting(false);
    }
  }, [postId, recognitionSubmitting, selectedRecognitionIds, t, load]);

  const openChat = useCallback(
    async (signer: PostSignupItem) => {
      if (openingChatRef.current) return;
      openingChatRef.current = true;
      // 报名→聊天：先构造卡片，目的地解析成功后再紧邻导航写入待发状态。
      const pendingChatCard = post
        ? {
          conversationKey: signer.userId,
          card: buildPostCard(post),
          draftText: t('plaza.signup.chatOpener', {
            defaultValue: '你报名了我发起的活动，开始聊天吧',
          }),
        }
        : null;
      try {
        setOpeningChatFor(signer.userId);
        // 先解析单聊会话拿到 conversationID，否则聊天页只会停在预览模式。
        const conversation = await ensureDirectConversation(signer.userId);
        if (pendingChatCard) setPendingChatCard(pendingChatCard);
        router.push(
          getChatDetailHref(
            scope,
            signer.userId,
            signer.nickname,
            signer.avatarUrl ?? undefined,
            conversation.conversationID,
          ),
        );
      } catch (error) {        Alert.alert(
          t('userProfile.openChatFailedTitle', { defaultValue: '打开聊天失败' }),
          getApiErrorMessage(
            error,
            t('common.networkError', { defaultValue: '网络错误，请重试' }),
          ),
        );
      } finally {
        openingChatRef.current = false;
        if (mountedRef.current) setOpeningChatFor(null);
      }
    },
    [router, scope, t, post, setPendingChatCard, buildPostCard],
  );

  const openSignerProfile = useCallback(
    (signer: PostSignupItem) => {
      router.push(getUserProfileHref(scope, signer.userId, signer.nickname));
    },
    [router, scope],
  );

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={[s.header, { borderBottomColor: colors.surfaceBorder }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text
          numberOfLines={1}
          style={{ fontSize: 17, fontWeight: '700', color: colors.text, flex: 1, textAlign: 'center' }}
        >
          {title || t('notifications.signupMgmt.signersTitle')}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <FlatList
        data={filteredSignups}
        keyExtractor={(item) => item.userId}
        ListHeaderComponent={
          // 认可面板仅在后端确认活动已结束、可认可时展示（recognitionOpen）。
          recognitionOpen && signups.length > 0 ? (
            <View
              style={[
                s.recognitionPanel,
                { borderBottomColor: colors.surfaceBorder },
              ]}
            >
              <View
                style={[
                  s.searchBox,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.surfaceBorder,
                  },
                ]}
              >
                <Ionicons name="search" size={18} color={colors.textSecondary} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t('notifications.signupMgmt.searchPlaceholder', {
                    defaultValue: '搜索报名者',
                  })}
                  placeholderTextColor={colors.textSecondary}
                  style={[s.searchInput, { color: colors.text }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={s.recognitionActions}>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                  {recognitionLocked
                    ? t('notifications.signupMgmt.recognitionFull', {
                        defaultValue: '认可名额已用完',
                      })
                    : t('notifications.signupMgmt.recognitionSelectionSummary', {
                        count: selectedRecognitionIds.size,
                        max: remainingSlots,
                        defaultValue: `已选 ${selectedRecognitionIds.size}/${remainingSlots}`,
                      })}
                </Text>
                <Pressable
                  testID="collaboration-recognition-submit"
                  onPress={() => void submitRecognitions()}
                  disabled={
                    selectedRecognitionIds.size === 0 ||
                    recognitionSubmitting ||
                    recognitionLocked
                  }
                  style={({ pressed }) => [
                    s.submitButton,
                    {
                      backgroundColor: colors.primary,
                      opacity:
                        selectedRecognitionIds.size === 0 ||
                        recognitionSubmitting ||
                        recognitionLocked
                          ? 0.45
                          : pressed
                            ? 0.8
                            : 1,
                    },
                  ]}
                >
                  <Ionicons name="ribbon-outline" size={16} color={colors.white} />
                  <Text style={[s.submitText, { color: colors.white }]}>
                    {recognitionSubmitting
                      ? t('notifications.signupMgmt.recognitionSubmitting', {
                          defaultValue: '提交中',
                        })
                      : t('notifications.signupMgmt.recognitionSubmit', {
                          defaultValue: '提交认可',
                        })}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const selected = selectedRecognitionIds.has(item.userId);
          const showRecognition = recognitionOpen;
          const displayIcons = item.displayIcons ?? [];
          const rowDisabled =
            !showRecognition ||
            item.recognized ||
            recognitionLocked ||
            recognitionSubmitting;
          return (
            <Pressable
              style={[
                s.row,
                selected ? [s.selectedRow, { backgroundColor: colors.primaryLight }] : null,
              ]}
              onPress={
                rowDisabled ? undefined : () => toggleRecognitionSelection(item)
              }
            >
              {showRecognition ? (
                <View
                  style={[
                    s.selectDot,
                    {
                      backgroundColor:
                        selected || item.recognized
                          ? colors.primary
                          : colors.surface,
                      borderColor:
                        selected || item.recognized
                          ? colors.primary
                          : colors.surfaceBorder,
                      opacity: item.recognized ? 0.6 : 1,
                    },
                  ]}
                >
                  {selected || item.recognized ? (
                    <Ionicons name="checkmark" size={14} color={colors.white} />
                  ) : null}
                </View>
              ) : null}
              <Pressable
                onPress={() => openSignerProfile(item)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={item.nickname}
              >
                <Avatar size={48} name={item.nickname} uri={item.avatarUrl ?? undefined} />
              </Pressable>
              <View style={s.body}>
                <View style={s.nameRow}>
                  <MemberName
                    name={item.nickname}
                    userId={item.userId}
                    numberOfLines={1}
                    style={{ fontSize: 16, fontWeight: '600', color: colors.text }}
                  />
                  {item.recognized ? (
                    <Text style={[s.recognizedTag, { color: colors.primary }]}>
                      {t('notifications.signupMgmt.recognizedTag', {
                        defaultValue: '已认可',
                      })}
                    </Text>
                  ) : null}
                  {displayIcons.length > 0 ? (
                    <View style={s.badgeRow}>
                      <UserIconRow icons={displayIcons} compact compactSize="small" />
                    </View>
                  ) : null}
                </View>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                  {t('notifications.signupMgmt.signedAt', {
                    time: formatRelativeTime(item.signedAt, t),
                  })}
                </Text>
              </View>
              {showRecognition ? null : (
                <Pressable
                  onPress={() => void openChat(item)}
                  disabled={openingChatFor === item.userId}
                  hitSlop={8}
                  style={s.chatButton}
                >
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={22}
                    color={colors.textSecondary}
                  />
                </Pressable>
              )}
            </Pressable>
          );
        }}
        ItemSeparatorComponent={Divider}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshing={refreshing}
        onRefresh={load}
        contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
              {loadError ??
                (signups.length > 0
                  ? t('notifications.signupMgmt.noSearchResults', {
                      defaultValue: '没有匹配的报名者',
                    })
                  : t('notifications.signupMgmt.noSigners'))}
            </Text>
            {loadError ? (
              <Pressable
                style={[s.retryBtn, { borderColor: colors.surfaceBorder }]}
                onPress={load}
                disabled={refreshing}
              >
                <Text style={{ color: colors.primary, fontWeight: '600' }}>
                  {t('common.retry')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  selectedRow: {
    borderRadius: 18,
  },
  recognitionPanel: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBox: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  recognitionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  submitButton: {
    minHeight: 36,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
  },
  submitText: {
    fontSize: 14,
    fontWeight: '700',
  },
  selectDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeRow: { flexShrink: 0 },
  recognizedTag: { fontSize: 11, fontWeight: '700' },
  empty: { paddingTop: 80, alignItems: 'center', gap: Spacing.md },
  retryBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
});
