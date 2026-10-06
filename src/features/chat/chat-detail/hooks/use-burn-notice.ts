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
  // 会话级阅后即焚由任一方开启后对双方生效；个人全局阅后即焚也要在自己的
  // 私聊里明确提示。提示开关曾经是一个已经从设置页移除的旧本地字段，继续读取
  // 它会让历史上保存为 false 的用户永久看不到提示，因此这里不再用它拦截。
  // 会话策略和本人的全局策略同时存在时，实际删除逻辑取更短的窗口；顶部提示
  // 必须使用同一套规则。否则「个人 5 分钟 + 会话 1 周」会实际 5 分钟消失，
  // 页面却写成 1 周，提示反而误导用户。
  // 深链/联系人入口可能在全量会话列表之前打开；私聊页单独拉一次会话策略补齐开关。
  // 对端的全局阅后即焚只过滤他自己的视图、不会烧掉这边的消息，不进提示也不进清理。
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
          defaultValue: '此对话已开启阅后即焚，新消息将在 {{duration}} 后消失',
        })
      : t('chat.detail.personalDisappearingMessageNotice', {
          duration: formatBurnDuration(effectiveBurnDurationSec),
          defaultValue: '你已开启阅后即焚，新消息将在 {{duration}} 后消失',
        })
    : null;

  return {
    conversationBurnNoticeText,
  };
}
