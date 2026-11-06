import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { sendCardMessage, sendTextMessage } from '@/chat-core/client';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { startChatSend } from '@/chat-core/send-handle';
import { ChatTargetPicker } from '@/features/chat/components/chat-target-picker/ChatTargetPicker';
import { resolveChatTargetConversationId } from '@/features/chat/components/chat-target-picker/resolve-chat-target';
import type { ChatTarget } from '@/features/chat/components/chat-target-picker/types';
import { useRecentForwardTargetsStore } from '@/features/chat/components/chat-target-picker/use-recent-forward-targets-store';
import { SendConfirmDialog } from '@/features/chat/components/send-confirm-dialog';
import { useAuthStore } from '@/stores/authStore';
import { diagnosticErrorMessage, logClientDiagnostic } from '@/utils/client-diagnostics';
import { Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: { flex: 1 },
  preview: { ...Typography.small },
});

/** 进队即返回;没进队(本地门禁)才抛错。 */
async function queueSend(send: (onCreate: () => void) => Promise<unknown>): Promise<void> {
  const handle = startChatSend(send);
  if (handle.queued) {
    handle.delivered.catch((error: unknown) => {
      logClientDiagnostic('share_circle_delivery_failed', { message: diagnosticErrorMessage(error) });
    });
    return;
  }
  await handle.delivered;
}

// 选聊天把圈子名片发过去,对方点名片进圈子详情就能申请加入。和转发、发笔记用同一个选择页。
export default function ShareCircleCardScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string; title?: string; avatar?: string }>();
  const circleId = typeof params.id === 'string' ? params.id : '';
  const circleName =
    typeof params.title === 'string' ? params.title : t('circle.card.type', { defaultValue: '圈子' });
  const circleAvatar = typeof params.avatar === 'string' && params.avatar ? params.avatar : null;
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const recordRecent = useRecentForwardTargetsStore((state) => state.record);
  const [confirmTargets, setConfirmTargets] = useState<ChatTarget[] | null>(null);
  const [sending, setSending] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleSend = useCallback(
    async (targets: ChatTarget[], caption: string) => {
      if (!circleId || inFlightRef.current) return;
      inFlightRef.current = true;
      setSending(true);
      const delivered: ChatTarget[] = [];
      let firstError: unknown = null;
      for (const target of targets) {
        try {
          const conversationId = await resolveChatTargetConversationId(target);
          // 进了发送队列就算发出:断线时队列自己等重连,发不出去的在会话里标红可重发,
          // 这里不等送达,页面也就不会因为网络卡住一直转圈。
          await queueSend((onCreate) =>
            sendCardMessage({
              conversationId,
              type: 'circle-card',
              payload: { circleId, name: circleName, avatarUrl: circleAvatar },
              onCreate,
            }),
          );
          if (caption) {
            await queueSend((onCreate) => sendTextMessage({ conversationId, text: caption, onCreate }));
          }
          delivered.push({ ...target, key: conversationId, conversationId });
        } catch (error) {
          firstError ??= error;
          logClientDiagnostic('share_circle_send_failed', {
            circleId,
            message: diagnosticErrorMessage(error),
          });
        }
      }
      inFlightRef.current = false;
      if (userId && delivered.length > 0) recordRecent(userId, delivered);
      if (!mountedRef.current) return;
      setSending(false);
      if (firstError) {
        Alert.alert(
          t('circle.shareCard.failedTitle', { defaultValue: '发送失败' }),
          getChatSendErrorMessage(firstError, t('common.retryLater', { defaultValue: '请稍后重试' })),
        );
        return;
      }
      router.back();
    },
    [circleAvatar, circleId, circleName, recordRecent, t, userId],
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <ChatTargetPicker
        title={t('circle.shareCard.title', { defaultValue: '发送圈子名片' })}
        busy={sending}
        onClose={() => router.back()}
        onConfirm={setConfirmTargets}
      />
      <SendConfirmDialog
        visible={confirmTargets !== null}
        title={
          confirmTargets && confirmTargets.length > 1
            ? t('chat.forward.sendToMany', {
                count: confirmTargets.length,
                defaultValue: '分别发送给 {{count}} 个聊天',
              })
            : t('chat.forward.sendTo', {
                name: confirmTargets?.[0]?.name ?? '',
                defaultValue: '发送给 {{name}}',
              })
        }
        placeholder={t('chat.forward.captionPlaceholder', { defaultValue: '给朋友留言（可选）' })}
        onCancel={() => setConfirmTargets(null)}
        onConfirm={(caption) => {
          const targets = confirmTargets;
          setConfirmTargets(null);
          if (targets) void handleSend(targets, caption);
        }}
      >
        <Text style={[s.preview, { color: colors.textSecondary }]} numberOfLines={2}>
          {t('circle.shareCard.preview', { circleName, defaultValue: '[圈子名片] {{circleName}}' })}
        </Text>
      </SendConfirmDialog>
    </View>
  );
}
