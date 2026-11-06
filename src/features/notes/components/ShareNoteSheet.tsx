import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { sendTextMessage } from '@/chat-core/client';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { ChatTargetPicker } from '@/features/chat/components/chat-target-picker/ChatTargetPicker';
import { resolveChatTargetConversationId } from '@/features/chat/components/chat-target-picker/resolve-chat-target';
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
 */
export function ShareNoteSheet({ request, onClose }: ShareNoteSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const visible = request !== null && request.notes.length > 0;
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const recordRecent = useRecentForwardTargetsStore((state) => state.record);
  const [confirmTargets, setConfirmTargets] = useState<ChatTarget[] | null>(null);
  const [sending, setSending] = useState(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const sendTimestampsRef = useRef<number[]>([]);
  // 面板一次「打开」的代数：关闭即作废。关掉后还在路上的发送停发剩余内容，
  // 收尾（关面板 / 报错）也不能落到已经关掉或重新打开的面板上。
  const openGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      setConfirmTargets(null);
      openGenerationRef.current += 1;
    }
  }, [visible]);

  const handleConfirm = useCallback(
    async (chosen: ChatTarget[], caption: string) => {
      if (!request || inFlightRef.current) return;
      inFlightRef.current = true;
      setSending(true);
      const generation = openGenerationRef.current;
      const isCurrent = () => mountedRef.current && openGenerationRef.current === generation;
      let failures = 0;
      let firstError: unknown = null;
      const delivered: ChatTarget[] = [];
      try {
        for (const target of chosen) {
          if (!isCurrent()) break;
          let conversationId: string;
          try {
            conversationId = await resolveChatTargetConversationId(target);
          } catch (error) {
            reportHandledFailure('noteShare', 'resolveTarget', error);
            failures += 1;
            firstError ??= error;
            continue;
          }
          const result = await sendNotesToConversation({
            conversationId,
            notes: request.notes,
            options: request.options,
            ownerId: userId,
            sendTimestamps: sendTimestampsRef,
            isActive: isCurrent,
          });
          failures += result.failures;
          firstError ??= result.firstError;
          if (caption && isCurrent()) {
            try {
              await sendTextMessage({ conversationId, text: caption });
            } catch (error) {
              failures += 1;
              firstError ??= error;
            }
          }
          delivered.push({ ...target, key: conversationId, conversationId });
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setSending(false);
        if (userId && delivered.length > 0) recordRecent(userId, delivered);
      }
      if (!isCurrent()) return;
      if (failures === 0) {
        // 全部成功直接收起，不再弹「已发送」。
        onClose();
        return;
      }
      const countMessage = t('notes.shareToChat.partialFailed', {
        count: failures,
        defaultValue: `有 ${failures} 条内容发送失败。`,
      });
      Alert.alert(
        t('notes.shareToChat.failedTitle', { defaultValue: '发送失败' }),
        firstError ? getChatSendErrorMessage(firstError, countMessage) : countMessage,
      );
    },
    [onClose, recordRecent, request, t, userId],
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
      onRequestClose={sending ? undefined : onClose}
    >
      <ChatTargetPicker busy={sending} onClose={onClose} onConfirm={setConfirmTargets} />
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
          if (chosen) void handleConfirm(chosen, caption);
        }}
      >
        <Text style={[s.preview, { color: colors.textSecondary }]} numberOfLines={3}>
          {preview}
        </Text>
      </SendConfirmDialog>
    </Modal>
  );
}
