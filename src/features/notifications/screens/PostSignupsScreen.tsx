import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { Spacing, useTheme } from '@/theme';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import { fetchMyPostSignups, markMyPostSignupsRead } from '@/services/api/plaza';
import { getOrCreateSingleConversation } from '@/im/client';
import { shouldOpenChatPreview } from '@/features/chat/chat-preview';
import {
  getChatDetailHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import { useNotificationCenterStore } from '@/features/notifications/store/use-notification-center-store';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import type { PostSignupItem } from '@/types';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

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
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!postId) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      const items = await fetchMyPostSignups(postId);
      if (!mountedRef.current) return;
      setSignups(items);
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
          if (isDev) console.warn('[PostSignupsScreen] mark read failed', error);
        }
      }
    } catch (error) {
      if (isDev) console.warn('[PostSignupsScreen] load failed', error);
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

  const [openingChatFor, setOpeningChatFor] = useState<string | null>(null);

  const openChat = useCallback(
    async (signer: PostSignupItem) => {
      if (openingChatRef.current) return;
      openingChatRef.current = true;
      try {
        setOpeningChatFor(signer.userId);
        // 先解析单聊会话拿到 conversationID，否则聊天页只会停在预览模式。
        const conversation = await getOrCreateSingleConversation(signer.userId);
        router.push(
          getChatDetailHref(
            scope,
            signer.userId,
            signer.nickname,
            signer.avatarUrl ?? undefined,
            conversation.conversationID,
          ),
        );
      } catch (error) {
        if (shouldOpenChatPreview(error)) {
          // IM 未接通：退化成预览模式（无 conversationID）。
          router.push(
            getChatDetailHref(
              scope,
              signer.userId,
              signer.nickname,
              signer.avatarUrl ?? undefined,
            ),
          );
          return;
        }
        Alert.alert(
          t('userProfile.openChatFailedTitle', { defaultValue: '打开聊天失败' }),
          error instanceof Error
            ? error.message
            : t('common.networkError', { defaultValue: '网络错误，请重试' }),
        );
      } finally {
        openingChatRef.current = false;
        if (mountedRef.current) setOpeningChatFor(null);
      }
    },
    [router, scope, t],
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
        data={signups}
        keyExtractor={(item) => item.userId}
        renderItem={({ item }) => (
          <Pressable
            style={s.row}
            onPress={() => void openChat(item)}
            disabled={openingChatFor === item.userId}
          >
            <Avatar size={48} name={item.nickname} uri={item.avatarUrl ?? undefined} />
            <View style={s.body}>
              <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
                {item.nickname}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                {t('notifications.signupMgmt.signedAt', {
                  time: formatRelativeTime(item.signedAt, t),
                })}
              </Text>
            </View>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        )}
        ItemSeparatorComponent={Divider}
        refreshing={refreshing}
        onRefresh={load}
        contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
              {loadError ?? t('notifications.signupMgmt.noSigners')}
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
  body: { flex: 1, gap: 4 },
  empty: { paddingTop: 80, alignItems: 'center', gap: Spacing.md },
  retryBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
});
