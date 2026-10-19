import { formatBurnDuration } from '@/chat-core/burn-durations';
import { type TFunction } from 'i18next';
import { type ConversationKind } from '@/features/chat/chat-detail/types';

export interface BurnNoticeParams {
  t: TFunction<"translation", undefined>;
  conversationBurnEnabled: boolean;
  conversationBurnDurationSec: number;
  viewerSelfDestructSec: number;
  remoteBurnPolicy: { burnDurationSec: number | null; burnStartedAt: string | null; } | null;
  conversationType: ConversationKind;
}

/**
 * 单聊顶部的阅后即焚提示:会话策略与本人全局策略取实际生效的更短窗口,文案说明是谁开的。
 */
export function useBurnNotice({
  t,
  conversationBurnEnabled,
  conversationBurnDurationSec,
  viewerSelfDestructSec,
  remoteBurnPolicy,
  conversationType,
}: BurnNoticeParams) {
  // REST/会话 DTO 只提供本人的发送策略；另一位成员的设置不进入此提示。
  const resolvedConversationBurnDurationSec = conversationBurnEnabled
    ? conversationBurnDurationSec
    : (remoteBurnPolicy?.burnDurationSec ?? 0);
  // 即 Math.min(resolvedConversationBurnDurationSec, viewerSelfDestructSec)，只是忽略 0：
  // 都关着必须是 0（off），不能是 Math.min() 的 Infinity。
  const positiveBurnDurations = [
    resolvedConversationBurnDurationSec,
    viewerSelfDestructSec,
  ].filter((duration) => duration > 0);
  const effectiveBurnDurationSec =
    positiveBurnDurations.length > 0 ? Math.min(...positiveBurnDurations) : 0;
  const noticeUsesConversationPolicy =
    resolvedConversationBurnDurationSec > 0 &&
    resolvedConversationBurnDurationSec === effectiveBurnDurationSec;
  const showConversationBurnNotice =
    conversationType === 'single' && effectiveBurnDurationSec > 0;
  const conversationBurnNoticeText = showConversationBurnNotice
    ? noticeUsesConversationPolicy
      ? t('chat.detail.disappearingMessageNotice', {
          duration: formatBurnDuration(effectiveBurnDurationSec),
          defaultValue: '你发送的新消息将在对方已读 {{duration}} 后消失，不影响对方发送的消息。平台会在消息消失后留存180天，供授权管理员审计。',
        })
      : t('chat.detail.personalDisappearingMessageNotice', {
          duration: formatBurnDuration(effectiveBurnDurationSec),
          defaultValue: '你发送的新消息将在对方已读 {{duration}} 后消失，不影响对方发送的消息。平台会在消息消失后留存180天，供授权管理员审计。',
        })
    : null;

  return {
    conversationBurnNoticeText,
  };
}
