import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { sendCardMessage, sendTextMessage } from '@/chat-core/client';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { startChatSend } from '@/chat-core/send-handle';
import { announceSent } from '@/features/chat/components/chat-target-picker/announce-sent';
import { ChatTargetPicker } from '@/features/chat/components/chat-target-picker/ChatTargetPicker';
import {
  chatTargetResolveFailureMessage,
  resolveChatTargets,
  type ResolvedChatTarget,
} from '@/features/chat/components/chat-target-picker/resolve-chat-target';
import type { ChatTarget } from '@/features/chat/components/chat-target-picker/types';
import { useRecentForwardTargetsStore } from '@/features/chat/components/chat-target-picker/use-recent-forward-targets-store';
import { SendConfirmDialog } from '@/features/chat/components/send-confirm-dialog';
import { showTopNotice } from '@/components/app/top-notice-store';
import { useAuthStore } from '@/stores/authStore';
import { diagnosticErrorMessage, logClientDiagnostic } from '@/utils/client-diagnostics';
import { Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: { flex: 1 },
  preview: { ...Typography.small },
});

/**
 * 进队即返回「最终是否送达」(不等它);没进队(本地门禁)才抛错。
 * 包在对象里:async 函数直接返回 promise 会被摊平成等待。
 */
async function queueSend(
  send: (onCreate: () => void) => Promise<unknown>,
): Promise<{ delivered: Promise<boolean> }> {
  const handle = startChatSend(send);
  if (!handle.queued) {
    await handle.delivered;
    return { delivered: Promise.resolve(true) };
  }
  return {
    delivered: handle.delivered.then(
      () => true,
      (error: unknown) => {
        logClientDiagnostic('share_circle_delivery_failed', { message: diagnosticErrorMessage(error) });
        return false;
      },
    ),
  };
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

  /** 后台把名片(和留言)发给每个对象;失败用顶部提示报,因为这时选择页多半已经关了。 */
  const sendInBackground = useCallback(
    async (targets: ChatTarget[], caption: string): Promise<ResolvedChatTarget[]> => {
      const failedTitle = t('circle.shareCard.failedTitle', { defaultValue: '发送失败' });
      const { resolved, failed } = await resolveChatTargets(targets);
      if (failed.length > 0) {
        failed.forEach((item) =>
          logClientDiagnostic('share_circle_resolve_failed', {
            circleId,
            message: diagnosticErrorMessage(item.error),
          }),
        );
        showTopNotice({
          type: 'error',
          title: failedTitle,
          message: chatTargetResolveFailureMessage(
            failed,
            t,
            t('common.retryLater', { defaultValue: '请稍后重试' }),
          ),
        });
      }
      const delivered: ChatTarget[] = [];
      for (const { target, conversationId } of resolved) {
        try {
          // 进了发送队列就算发出:断线时队列自己等重连,发不出去的在会话里标红可重发。
          const card = await queueSend((onCreate) =>
            sendCardMessage({
              conversationId,
              type: 'circle-card',
              payload: { circleId, name: circleName, avatarUrl: circleAvatar },
              onCreate,
            }),
          );
          if (caption) {
            // 留言等名片有了结果再发:名片被拒收时不单独把留言发过去。
            void card.delivered.then(async (ok) => {
              if (!ok) {
                showTopNotice({
                  type: 'error',
                  title: t('chat.forward.captionSkipped', {
                    defaultValue: '转发内容没有发出，留言也没有发送',
                  }),
                });
                return;
              }
              await (
                await queueSend((onCreate) =>
                  sendTextMessage({ conversationId, text: caption, onCreate }),
                )
              ).delivered;
            }).catch((error: unknown) => {
              logClientDiagnostic('share_circle_caption_failed', {
                message: diagnosticErrorMessage(error),
              });
            });
          }
          delivered.push({ ...target, key: conversationId, conversationId });
        } catch (error) {
          logClientDiagnostic('share_circle_send_failed', {
            circleId,
            message: diagnosticErrorMessage(error),
          });
          showTopNotice({
            type: 'error',
            title: failedTitle,
            message: `${target.name}：${getChatSendErrorMessage(
              error,
              t('common.retryLater', { defaultValue: '请稍后重试' }),
            )}`,
          });
        }
      }
      if (userId && delivered.length > 0) recordRecent(userId, delivered);
      return resolved;
    },
    [circleAvatar, circleId, circleName, recordRecent, t, userId],
  );

  const handleSend = useCallback(
    (targets: ChatTarget[], caption: string) => {
      if (!circleId) return;
      const resolution = sendInBackground(targets, caption).catch((error: unknown) => {
        logClientDiagnostic('share_circle_send_failed', {
          circleId,
          message: diagnosticErrorMessage(error),
        });
        return [];
      });
      announceSent({ t, targets, resolution, onDismiss: () => router.back() });
    },
    [circleId, sendInBackground, t],
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <ChatTargetPicker
        title={t('circle.shareCard.title', { defaultValue: '发送圈子名片' })}
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
          if (targets) handleSend(targets, caption);
        }}
      >
        <Text style={[s.preview, { color: colors.textSecondary }]} numberOfLines={2}>
          {t('circle.shareCard.preview', { circleName, defaultValue: '[圈子名片] {{circleName}}' })}
        </Text>
      </SendConfirmDialog>
    </View>
  );
}
