import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '@/i18n';
import { NavHeader } from '@/components/ui/nav-header';
import { useMessageForwardStore } from '@/features/chat/store/use-message-forward-store';
import { isEphemeralPeerMessage } from '@/features/chat/utils/ephemeral-message';
import { startChatSend } from '@/chat-core/send-handle';
import {
  sendCardMessage,
  sendForwardedMediaMessage,
  sendLocationMessage,
  sendTextMessage,
  type ChatCardType,
} from '@/chat-core/client';
import { getChatMessagePreview } from '@/chat-core/mappers';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { showTopNotice } from '@/components/app/top-notice-store';
import { SendConfirmDialog } from '@/features/chat/components/send-confirm-dialog';
import { announceSent } from '@/features/chat/components/chat-target-picker/announce-sent';
import { ChatTargetPicker } from '@/features/chat/components/chat-target-picker/ChatTargetPicker';
import {
  chatTargetResolveFailureMessage,
  resolveChatTargets,
  type ResolvedChatTarget,
} from '@/features/chat/components/chat-target-picker/resolve-chat-target';
import type { ChatTarget } from '@/features/chat/components/chat-target-picker/types';
import { useRecentForwardTargetsStore } from '@/features/chat/components/chat-target-picker/use-recent-forward-targets-store';
import type { ChatMessageDto } from '@/chat-core/protocol';
import { useAuthStore } from '@/stores/authStore';
import { Spacing, Typography, useTheme } from '@/theme';
import type { ChatMessage } from '@/types';
import { reportHandledFailure } from '@/observability/report-failure';

type PendingForward = {
  message: ChatMessage;
  dto?: ChatMessageDto;
};

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  subtitle: { ...Typography.small },
});

// 可直接按原 payload 重发的卡片类型 —— 即客户端本来就能发的那几种(ChatCardType)。
// 回执类一律排除:transfer-card / verification-card 都是服务端签发的凭证,
// 原样转发等于伪造一笔转账、或伪造一份验证邀请;它们在后端也只认服务端写入,
// 客户端重发必被拒。转账卡保留文本降级形态,验证卡连长按菜单都不提供
// (见 ChatDetailScreen 的 'verification-card' 分支:没有 withMessageActions)。
// 广场报名卡同样排除:它只由报名列表定向创建,不提供二次扩散入口。
const FORWARDABLE_CARD_TYPES: ChatCardType[] = [
  'note-card',
  'friend-card',
  'circle-card',
];

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 这条消息能不能转发 —— 菜单和转发页共用同一个判定,不能各判各的。
 *
 * 之前长按任何消息都提供「转发」,而 call-record 在转发页既没有分支也没有兜底文案,
 * 必走到最后那个 throw;catch 提示「请重试」,可重试永远不会成功。
 * 通话记录本身也没有转发语义(它是一次通话在本会话里的留痕),所以直接不提供入口。
 */
export function canForwardMessage(
  message: ChatMessage,
  dto?: ChatMessageDto,
  conversationBurnEnabled = false,
): boolean {
  if (message.type === 'call-record') return false;
  if (message.type === 'system-notice') return false;
  // 阅后即焚会话里别人发的东西，服务端已经按 CHAT_FORWARD_FORBIDDEN 拒了。
  // 端上不挡，用户就得挑完目标会话才在最后一步吃到那个错误。
  if (isEphemeralPeerMessage(message, conversationBurnEnabled)) return false;
  if (
    message.type === 'image' ||
    message.type === 'video' ||
    message.type === 'voice'
  ) {
    return dto !== undefined && dto.height > 0;
  }
  return true;
}

function getForwardFallbackText(message: ChatMessage) {
  if (message.type === 'sent' || message.type === 'received') {
    return message.text?.trim() ?? '';
  }
  if (message.type === 'location') {
    return i18n
      .t('chat.forward.locationWithDetail', {
        detail: message.locationTitle ?? message.locationAddress ?? '',
        defaultValue: '[位置] {{detail}}',
      })
      .trim();
  }
  if (message.type === 'transfer-card') {
    return i18n
      .t('im.preview.transferWithAmount', {
        amount: message.transferCard?.amount ?? '',
        defaultValue: '[转账] {{amount}} 积分',
      })
      .trim();
  }
  return '';
}

/**
 * 媒体转发只提交源消息 ID，由服务端校验源会话可见性并复制对象；其他可转发
 * 类型继续按已有载荷重发。拿不到 DTO 时退化成文本转发。
 */
async function sendForwardedMessage(
  pending: PendingForward,
  conversationId: string,
  onCreate: () => void,
) {
  const { dto, message } = pending;
  const content = dto?.content ?? {};

  if (dto) {
    if (
      dto.height > 0 &&
      (dto.type === 'image' || dto.type === 'video' || dto.type === 'voice')
    ) {
      return sendForwardedMediaMessage({
        conversationId,
        sourceMessageId: dto.id,
        type: dto.type,
        previewContent: content,
        onCreate,
      });
    }
    if (dto.type === 'location') {
      const latitude = num(content['latitude']);
      const longitude = num(content['longitude']);
      if (latitude !== undefined && longitude !== undefined) {
        return sendLocationMessage({
          conversationId,
          latitude,
          longitude,
          title: str(content['title']),
          address: str(content['address']),
          description: str(content['description']) ?? '',
          onCreate,
        });
      }
    }
    if ((FORWARDABLE_CARD_TYPES as string[]).includes(dto.type)) {
      return sendCardMessage({
        conversationId,
        type: dto.type as ChatCardType,
        payload: content,
        onCreate,
      });
    }
    if (dto.type === 'text' || dto.type === 'quote') {
      const text = str(content['text'])?.trim();
      if (text) {
        return sendTextMessage({ conversationId, text, onCreate });
      }
    }
  }

  const text = getForwardFallbackText(message);
  if (text) {
    return sendTextMessage({ conversationId, text, onCreate });
  }

  throw new Error(
    i18n.t('chat.forward.unsupported', { defaultValue: '该消息类型暂不支持转发' }),
  );
}

export default function ForwardPickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const pending = useMessageForwardStore((state) => state.pending);
  const pendingBatch = useMessageForwardStore((state) => state.pendingBatch);
  const clearPending = useMessageForwardStore((state) => state.clear);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const recordRecent = useRecentForwardTargetsStore((state) => state.record);
  // 选中对象后先停在「发送给」确认框,可以附一句留言再转发。
  const [confirmTargets, setConfirmTargets] = useState<ChatTarget[] | null>(null);
  // 点了发送就关页,同一页里不会再发第二次:挡住确认框连点。
  const sendingRef = useRef(false);

  /**
   * 进队即算成功,返回「最终是否送达」的结果但不等它;没进队(本地门禁)直接抛,
   * 由外层报「转发失败」。包在对象里:async 函数直接返回 promise 会被摊平成等待。
   */
  async function queueSend(
    send: (onCreate: () => void) => Promise<unknown>,
    step: string,
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
          reportHandledFailure('forward', step, error);
          return false;
        },
      ),
    };
  }

  /**
   * 留言是一条普通文字消息,等这个对象的转发内容都有了结果再发:一条都没送达
   * (服务端拒收)时不单独把留言发过去,改成顶部提示。
   */
  function queueCaptionAfter(
    deliveries: readonly Promise<boolean>[],
    conversationId: string,
    caption: string,
  ) {
    void Promise.all(deliveries)
      .then(async (results) => {
        if (!results.some(Boolean)) {
          showTopNotice({
            type: 'error',
            title: t('chat.forward.captionSkipped', {
              defaultValue: '转发内容没有发出，留言也没有发送',
            }),
          });
          return;
        }
        const { delivered } = await queueSend(
          (onCreate) => sendTextMessage({ conversationId, text: caption, onCreate }),
          'forwardCaption',
        );
        await delivered;
      })
      .catch((error: unknown) => {
        reportHandledFailure('forward', 'forwardCaption', error);
      });
  }

  /** 后台把要转发的内容(和留言)发给每个对象;失败用顶部提示报,这时选择页多半已经关了。 */
  async function forwardInBackground(
    targets: ChatTarget[],
    items: PendingForward[],
    caption: string,
  ): Promise<ResolvedChatTarget[]> {
    const { resolved, failed } = await resolveChatTargets(targets);
    if (failed.length > 0) {
      failed.forEach((item) => reportHandledFailure('forward', 'resolveTarget', item.error));
      showTopNotice({
        type: 'error',
        title: t('chat.forward.failed'),
        message: chatTargetResolveFailureMessage(failed, t, t('chat.forward.failedRetry')),
      });
    }
    const delivered: ChatTarget[] = [];
    for (const { target, conversationId } of resolved) {
      try {
        // sendWithOptimism 已把发出的消息写进 chat-core store,无需手动 append。
        // 进了发送队列就算转发成功,不等送达:断线时队列会等到重连,之后仍发不出去的
        // 在目标会话里标红、可以长按重发。没进队(类型不支持、本地门禁)才报失败。
        const deliveries: Promise<boolean>[] = [];
        for (const item of items) {
          const { delivered: itemDelivered } = await queueSend(
            (onCreate) => sendForwardedMessage(item, conversationId, onCreate),
            'forwardMessage',
          );
          deliveries.push(itemDelivered);
        }
        if (caption) queueCaptionAfter(deliveries, conversationId, caption);
        delivered.push({ ...target, key: conversationId, conversationId });
      } catch (error) {
        reportHandledFailure('forward', 'forwardMessage', error);
        showTopNotice({
          type: 'error',
          title: t('chat.forward.failed'),
          message: `${target.name}：${getChatSendErrorMessage(error, t('chat.forward.failedRetry'))}`,
        });
      }
    }
    if (userId && delivered.length > 0) recordRecent(userId, delivered);
    return resolved;
  }

  function handleForward(targets: ChatTarget[], caption: string) {
    if (!pending || sendingRef.current || targets.length === 0) return;
    sendingRef.current = true;
    // 先把要发的内容拿在手里:关页时会清掉转发暂存。
    const items = pendingBatch ?? [pending];
    const resolution = forwardInBackground(targets, items, caption).catch((error: unknown) => {
      reportHandledFailure('forward', 'forwardMessage', error);
      return [];
    });
    announceSent({
      t,
      targets,
      resolution,
      onDismiss: () => {
        clearPending();
        router.back();
      },
    });
  }

  const forwardPreview = pendingBatch && pendingBatch.length > 1
    ? t('chat.forward.batchPreview', {
        count: pendingBatch.length,
        defaultValue: '共 {{count}} 条消息',
      })
    : pending
      ? (pending.dto ? getChatMessagePreview(pending.dto) : getForwardFallbackText(pending.message))
      : '';

  if (!pending) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <NavHeader title={t('chat.forward.title')} />
        <View style={s.center}>
          <Text style={[s.subtitle, { color: colors.textSecondary }]}>{t('chat.forward.empty')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <ChatTargetPicker
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
          if (targets) handleForward(targets, caption);
        }}
      >
        <Text style={[s.subtitle, { color: colors.textSecondary }]} numberOfLines={3}>
          {forwardPreview}
        </Text>
      </SendConfirmDialog>
    </View>
  );
}
