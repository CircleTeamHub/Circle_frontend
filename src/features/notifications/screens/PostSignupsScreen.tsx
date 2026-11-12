import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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
import { Badge } from '@/components/ui/badge';
import { useChatStore } from '@/chat-core/store';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { MemberName } from '@/components/ui/member-name';
import { Divider } from '@/components/ui/divider';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { UserIconRow } from '@/components/ui/user-icon-row';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { Spacing, useTheme } from '@/theme';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import {
  fetchMyPostSignups,
  fetchMyPlazaPost,
  markMyPostSignupsRead,
  submitPostCollaborationRecognitions,
  updateMyPlazaPost,
} from '@/services/api/plaza';
import { getApiErrorMessage } from '@/services/api/errors';
import { ensureDirectConversation } from '@/chat-core/client';
import { usePendingChatCardStore } from '@/features/chat/store/use-pending-chat-card-store';
import { toPlazaPostCardData } from '@/features/discover/utils/plaza-post-card';
import { PlazaPostCard } from '@/features/discover/components/plaza-post-card';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import {
  getChatDetailHref,
  getUserProfileHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { markMatchingTargetNotificationsRead } from '@/features/notifications/utils/seen-target';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useAuthStore } from '@/stores/authStore';
import type { CirclePlazaPost, Conversation, PlazaPostCardData, PostSignupItem } from '@/types';
import { reportHandledFailure } from '@/observability/report-failure';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { RecognitionPickerModal } from '@/features/notifications/components/RecognitionPickerModal';

export default function PostSignupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const { colors } = useTheme();
  const { t } = useTranslation();
  const mountedRef = useRef(true);
  const openingChatRef = useRef(false);
  const { postId } = useLocalSearchParams<{ postId: string }>();

  const [signups, setSignups] = useState<PostSignupItem[]>([]);
  const [post, setPost] = useState<CirclePlazaPost | null>(null);
  const [postLoadFailed, setPostLoadFailed] = useState(false);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const setPendingChatCard = usePendingChatCardStore((s) => s.setPending);
  const [recognitionOpen, setRecognitionOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recognitionPickerOpen, setRecognitionPickerOpen] = useState(false);
  const [recognitionSubmitting, setRecognitionSubmitting] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadPost = useCallback(async () => {
    if (!postId) return;
    setPostLoadFailed(false);
    try {
      const data = await fetchMyPlazaPost(postId);
      if (mountedRef.current) setPost(data);
    } catch (error) {
      reportHandledFailure('postSignups', 'loadPost', error);
      if (mountedRef.current) setPostLoadFailed(true);
    }
  }, [postId]);

  useEffect(() => {
    void loadPost();
  }, [loadPost]);

  const savePost = async () => {
    const content = editContent?.trim();
    if (!post || !content || savingRef.current) return;
    if (content === post.content) {
      setEditContent(null);
      return;
    }
    const { sessionEpoch } = useAuthStore.getState();
    savingRef.current = true;
    setSaving(true);
    try {
      await updateMyPlazaPost(post.id, content);
      if (useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      useDiscoverStore.getState().updatePlazaPostContent(post.id, content);
      useNotificationCenterStore.getState().updateSignupPostExcerpt(post.id, content.slice(0, 60));
      if (!mountedRef.current) return;
      setPost({ ...post, content });
      setEditContent(null);
    } catch (error) {
      if (!mountedRef.current) return;
      reportHandledFailure('postSignups', 'editPost', error);
      Alert.alert(
        t('common.errorOccurred'),
        getApiErrorMessage(error, t('common.networkError')),
      );
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleDeleted = (id: string) => {
    const store = useNotificationCenterStore.getState();
    const unread = store.signupPosts.find((item) => item.id === id)?.unreadSignupCount ?? 0;
    store.setSignupPosts(store.signupPosts.filter((item) => item.id !== id));
    if (unread > 0) {
      const badge = useTabBadgeStore.getState();
      badge.setSignupUnread(Math.max(0, badge.signupUnread - unread));
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({
        pathname: scope === 'messages' ? '/(tabs)/messages/notifications' : '/(tabs)/discover/notifications',
        params: { domain: 'circle' },
      });
    }
  };

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
    setLoading(true);
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
      if (mountedRef.current) setLoading(false);
    }
  }, [postId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // 打开页面、提交认可后的自动重拉只走 loading;下拉刷新控件只跟下拉走,见 usePullRefresh。
  const pull = usePullRefresh(async () => {
    await Promise.all([load(), loadPost()]);
  });

  useEffect(() => {
    void markMatchingTargetNotificationsRead({ circlePostId: postId });
  }, [postId]);

  const [openingChatFor, setOpeningChatFor] = useState<string | null>(null);

  // 已被认可的人数（后端 recognized 字段，刷新后仍准确）。每个帖子总额度 3 人，
  // 已认可的也计入额度，所以本次还能选的名额是 3 - 已认可数。
  const RECOGNITION_LIMIT = 3;
  const alreadyRecognizedCount = useMemo(
    () => signups.filter((item) => item.recognized).length,
    [signups],
  );
  const remainingSlots = Math.max(0, RECOGNITION_LIMIT - alreadyRecognizedCount);
  // 名额用尽（已认可满 3 人）时按钮置灰；活动未开放认可由后端 recognitionOpen 控制。
  const recognitionLocked = remainingSlots === 0;

  const submitRecognitions = useCallback(async (recipientIds: string[]) => {
    if (!postId || recipientIds.length === 0 || recognitionSubmitting) {
      return;
    }
    setRecognitionSubmitting(true);
    try {
      const result = await submitPostCollaborationRecognitions(postId, recipientIds);
      if (!mountedRef.current) return;
      setRecognitionPickerOpen(false);
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
  }, [postId, recognitionSubmitting, t, load]);

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

  // 报名行按消息列表的样子展示：和该报名者的单聊（若已有）的最近一条消息、时间与未读。
  const chatConversations = useChatStore((state) => state.conversations);
  const chatBySigner = useMemo(() => {
    const signerIds = new Set(signups.map((signer) => signer.userId));
    const bySigner = new Map<string, Conversation>();
    for (const dto of chatConversations) {
      const peerId = dto.type === 'DIRECT' ? dto.peer?.id : undefined;
      if (peerId && signerIds.has(peerId)) bySigner.set(peerId, mapChatConversationToUI(dto));
    }
    return bySigner;
  }, [chatConversations, signups]);

  const openSignerProfile = useCallback(
    (signer: PostSignupItem) => {
      router.navigate(getUserProfileHref(scope, signer.userId, signer.nickname));
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
          {t('plaza.postDetail.title')}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <FlatList
        {...keyboardDismissOnDragProps}
        data={signups}
        keyExtractor={(item) => item.userId}
        ListHeaderComponent={
          <>
          {post?.id === postId ? (
            <View style={s.postDetails}>
              <PlazaPostCard
                post={post}
                scope={scope === 'messages' ? 'messages' : 'discover'}
                onDeleted={handleDeleted}
                onEdit={() => setEditContent(post.content)}
                showSignupAction={false}
                showShareAction={Date.parse(post.expiresAt) > Date.now()}
              />
            </View>
          ) : postLoadFailed ? (
            <Pressable accessibilityRole="button" style={s.postDetails} onPress={loadPost}>
              <Text style={{ color: colors.iconAccent }}>
                {t('plaza.postDetail.loadFailed')}
              </Text>
              <Text style={{ color: colors.textSecondary }}>{t('common.retry')}</Text>
            </Pressable>
          ) : (
            <ActivityIndicator style={s.postDetails} color={colors.iconAccent} />
          )}
          <View style={s.signersHeader}>
            <Text accessibilityRole="header" style={[s.signersHeading, { color: colors.text }]}>
              {t('notifications.signupMgmt.signersTitle')}
            </Text>
            {/* 认可是单独的入口：后端确认活动已结束、可认可时才出现，点开在弹层里选人。
                下面的报名列表只做对话入口，不和认可共用。 */}
            {recognitionOpen && signups.length > 0 ? (
              <Pressable
                testID="collaboration-recognition-open"
                accessibilityRole="button"
                disabled={recognitionLocked}
                onPress={() => setRecognitionPickerOpen(true)}
                style={({ pressed }) => [
                  s.recognitionButton,
                  {
                    backgroundColor: recognitionLocked ? colors.surfaceBorder : colors.primary,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons name="ribbon-outline" size={15} color={colors.white} />
                <Text style={[s.recognitionButtonText, { color: colors.white }]}>
                  {recognitionLocked
                    ? t('notifications.signupMgmt.recognitionFull', { defaultValue: '认可名额已用完' })
                    : t('notifications.signupMgmt.recognitionSubmit', { defaultValue: '提交认可' })}
                </Text>
              </Pressable>
            ) : null}
          </View>
          </>
        }
        renderItem={({ item }) => {
          const displayIcons = item.displayIcons ?? [];
          const chat = chatBySigner.get(item.userId);
          return (
            // 同消息列表：整行就是和这位报名者的对话入口。
            <Pressable
              style={s.row}
              onPress={() => void openChat(item)}
              disabled={openingChatFor === item.userId}
            >
              <Pressable
                onPress={() => openSignerProfile(item)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={item.nickname}
              >
                <Avatar size={48} name={item.nickname} uri={item.avatarUrl ?? undefined} />
              </Pressable>
              <View style={s.body}>
                <View style={s.rowTop}>
                  <View style={s.nameRow}>
                    <MemberName
                      name={item.nickname}
                      userId={item.userId}
                      numberOfLines={1}
                      style={{ fontSize: 15, fontWeight: '600', color: colors.text, flexShrink: 1 }}
                    />
                    {item.recognized ? (
                      <Text style={[s.recognizedTag, { color: colors.iconAccent }]}>
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
                  {chat?.time ? (
                    <Text style={[s.rowTime, { color: colors.textSecondary }]}>{chat.time}</Text>
                  ) : null}
                </View>
                <View style={s.rowBottom}>
                  {/* 还没聊过就显示报名时间，聊过就是最近一条消息。 */}
                  <Text style={[s.rowPreview, { color: colors.textSecondary }]} numberOfLines={1}>
                    {chat?.message ||
                      t('notifications.signupMgmt.signedAt', {
                        time: formatRelativeTime(item.signedAt, t),
                      })}
                  </Text>
                  {chat?.unreadCount ? <Badge count={chat.unreadCount} /> : null}
                </View>
              </View>
            </Pressable>
          );
        }}
        ItemSeparatorComponent={Divider}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: 40 }}
        ListEmptyComponent={loading && !pull.refreshing && signups.length === 0 ? (
          <View style={s.empty} testID="post-signups-loading">
            <ActivityIndicator color={colors.iconAccent} />
          </View>
        ) : (
          <View style={s.empty}>
            <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
              {loadError ?? t('notifications.signupMgmt.noSigners')}
            </Text>
            {loadError ? (
              <Pressable
                style={[s.retryBtn, { borderColor: colors.surfaceBorder }]}
                onPress={load}
                disabled={loading}
              >
                <Text style={{ color: colors.iconAccent, fontWeight: '600' }}>
                  {t('common.retry')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      />
      {recognitionPickerOpen ? (
        <RecognitionPickerModal
          signups={signups}
          remainingSlots={remainingSlots}
          submitting={recognitionSubmitting}
          onClose={() => setRecognitionPickerOpen(false)}
          onSubmit={(recipientIds) => void submitRecognitions(recipientIds)}
        />
      ) : null}
      {editContent !== null ? (
        <Modal
          animationType="slide"
          onRequestClose={() => { if (!saving) setEditContent(null); }}
        >
          <KeyboardAvoidingContainer style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
            <View style={[s.header, { borderBottomColor: colors.surfaceBorder }]}>
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => setEditContent(null)}>
                <Text style={{ color: colors.text }}>{t('common.cancel')}</Text>
              </Pressable>
              <Text style={[s.signersHeading, { color: colors.text }]}>{t('plaza.actions.editPost')}</Text>
              <Pressable accessibilityRole="button" disabled={saving || !editContent.trim()} onPress={() => void savePost()}>
                {saving ? <ActivityIndicator color={colors.iconAccent} /> : (
                  <Text style={{ color: editContent.trim() ? colors.iconAccent : colors.textSecondary }}>{t('common.save')}</Text>
                )}
              </Pressable>
            </View>
            <TextInput
              accessibilityLabel={t('plaza.actions.editPost')}
              value={editContent}
              onChangeText={setEditContent}
              editable={!saving}
              multiline
              maxLength={5000}
              style={[s.editInput, { color: colors.text, marginBottom: insets.bottom }]}
            />
          </KeyboardAvoidingContainer>
        </Modal>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  postDetails: { marginVertical: Spacing.md },
  signersHeading: { fontSize: 16, fontWeight: '700', paddingVertical: Spacing.sm },
  editInput: { flex: 1, textAlignVertical: 'top', fontSize: 16, padding: Spacing.md },
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
  signersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  recognitionButton: {
    minHeight: 32,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
  },
  recognitionButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  body: { flex: 1, gap: 4 },
  // 同消息列表的会话行：上半 名字（左）+ 时间（右），下半 预览（左）+ 未读（右）。
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: Spacing.sm },
  rowTime: { fontSize: 12 },
  rowPreview: { fontSize: 13, flex: 1 },
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
