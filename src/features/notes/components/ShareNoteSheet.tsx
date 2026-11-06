import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { sendTextMessage } from '@/chat-core/client';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { showTopNotice } from '@/components/app/top-notice-store';
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
import type { NoteSendOptions } from '@/features/chat/utils/note-batch-send';
import { sendNotesToConversation } from '@/features/chat/utils/send-notes-to-conversation';
import type { NoteSummary } from '@/features/notes/types';
import { reportHandledFailure } from '@/observability/report-failure';
import { useAuthStore } from '@/stores/authStore';
import { Typography, useTheme } from '@/theme';

/** 要分享的笔记和每条要发的分块(笔记卡片 / 图片视频 / 展示 / 地址)。 */
export interface NoteShareRequest {
  notes: NoteSummary[];
  options: NoteSendOptions;
}

/** 只发笔记卡片:笔记详情页「分享」等没有选项的入口。 */
export const NOTE_SHARE_CARD_ONLY: NoteSendOptions = {
  card: true,
  media: false,
  showcase: false,
  location: false,
};

interface ShareNoteSheetProps {
  /** 非空即打开。 */
  request: NoteShareRequest | null;
  onClose: () => void;
}

const s = StyleSheet.create({
  preview: { ...Typography.small },
});

/**
 * 分享笔记到聊天：用统一的「选择一个聊天」页选一个或多个对象，确认时可以附一句留言。
 * 每个对象按勾选的分块依次发出（媒体由服务端拷进我的聊天目录），留言排在最后。
 * 点发送立刻提示「已发送」，内容在后台接着发，不用对着选择页等。
 */
export function ShareNoteSheet({ request, onClose }: ShareNoteSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const visible = request !== null && request.notes.length > 0;
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const recordRecent = useRecentForwardTargetsStore((state) => state.record);
  const [confirmTargets, setConfirmTargets] = useState<ChatTarget[] | null>(null);
  // 用户级 20 条/10s 的发送桶,面板多次打开、几批同时在路上也共用这一个。
  const sendTimestampsRef = useRef<number[]>([]);

  useEffect(() => {
    if (!visible) setConfirmTargets(null);
  }, [visible]);

  /**
   * 后台把笔记(和留言)发给每个对象。关掉面板不影响:点「确定」就是要它接着发;
   * 只有换了账号才停发剩下的。失败用顶部提示报,这时面板多半已经关了。
   */
  const sendInBackground = useCallback(
    async (
      shared: NoteShareRequest,
      chosen: ChatTarget[],
      caption: string,
    ): Promise<ResolvedChatTarget[]> => {
      const failedTitle = t('notes.shareToChat.failedTitle', { defaultValue: '发送失败' });
      const isActive = () => useAuthStore.getState().user?.id === userId;
      const { resolved, failed } = await resolveChatTargets(chosen);
      if (failed.length > 0) {
        failed.forEach((item) => reportHandledFailure('noteShare', 'resolveTarget', item.error));
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
      let failures = 0;
      let firstError: unknown = null;
      const delivered: ChatTarget[] = [];
      for (const { target, conversationId } of resolved) {
        if (!isActive()) break;
        const result = await sendNotesToConversation({
          conversationId,
          notes: shared.notes,
          options: shared.options,
          ownerId: userId,
          sendTimestamps: sendTimestampsRef,
          isActive,
        });
        failures += result.failures;
        firstError ??= result.firstError;
        if (caption && isActive()) {
          if (result.sent === 0) {
            // 内容一条都没送达,单独把留言发过去没有意义:算作这一项也没发出。
            failures += 1;
          } else {
            try {
              await sendTextMessage({ conversationId, text: caption });
            } catch (error) {
              failures += 1;
              firstError ??= error;
            }
          }
        }
        if (result.sent > 0) delivered.push({ ...target, key: conversationId, conversationId });
      }
      if (userId && delivered.length > 0) recordRecent(userId, delivered);
      if (failures > 0) {
        const countMessage = t('notes.shareToChat.partialFailed', {
          count: failures,
          defaultValue: `有 ${failures} 条内容发送失败。`,
        });
        showTopNotice({
          type: 'error',
          title: failedTitle,
          message: firstError ? getChatSendErrorMessage(firstError, countMessage) : countMessage,
        });
      }
      return resolved;
    },
    [recordRecent, t, userId],
  );

  const handleConfirm = useCallback(
    (chosen: ChatTarget[], caption: string) => {
      if (!request) return;
      const resolution = sendInBackground(request, chosen, caption).catch((error: unknown) => {
        reportHandledFailure('noteShare', 'send', error);
        return [];
      });
      announceSent({ t, targets: chosen, resolution, onDismiss: onClose });
    },
    [onClose, request, sendInBackground, t],
  );

  const notes = request?.notes ?? [];
  const preview =
    notes.length > 1
      ? t('notes.shareToChat.batchPreview', { count: notes.length, defaultValue: '共 {{count}} 条笔记' })
      : t('notes.shareToChat.singlePreview', { title: notes[0]?.title ?? '', defaultValue: '[笔记] {{title}}' });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <ChatTargetPicker
        onClose={onClose}
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
          const chosen = confirmTargets;
          setConfirmTargets(null);
          if (chosen) handleConfirm(chosen, caption);
        }}
      >
        <Text style={[s.preview, { color: colors.textSecondary }]} numberOfLines={3}>
          {preview}
        </Text>
      </SendConfirmDialog>
    </Modal>
  );
}
