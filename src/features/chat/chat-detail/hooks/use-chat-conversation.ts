import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { resolveChatDetailIdentity } from '@/features/chat/chat-detail-identity';
import { useChatStore } from '@/chat-core/store';
import { isGroupManager } from '@/features/chat/group-admin-permissions';
// 消息数据面已切到 chat-core;成员目录 / @ 候选 / 在线状态仍走 OpenIM 双轨
// (OpenIM groupID === circle.id,ID 同值,Phase 3 随成员子系统一起迁)。
import {
  useGroupMemberViewAccess,
} from '@/features/chat/hooks/use-group-member-view-access';
import { allowsMemberProfiles } from '@/features/chat/utils/group-policy';
import { useFriendRemarkStore } from '@/stores/friendRemarkStore';
import { ensureCircleConversation, ensureDirectConversation } from '@/chat-core/client';
import { reportHandledFailure } from '@/observability/report-failure';
import { type TFunction } from 'i18next';
import type { ChatDetailRouteParams, ConversationKind } from '@/features/chat/chat-detail/types';

export interface ChatConversationParams {
  t: TFunction<"translation", undefined>;
  params: ChatDetailRouteParams;
  currentUserID: string | null;
}

/**
 * 聊天页正在看的是哪个会话、它现在处于什么状态:会话 id 归一与就地解析、单聊/群聊/临时房/独立群,
 * 禁言与全员禁言(输入区是否锁住)、阅后即焚开关、对端已读/送达水位、标题与头像、查看成员资料的权限。
 */
export function useChatConversation({
  t,
  params,
  currentUserID,
}: ChatConversationParams) {
  // 迁移窗口的旧 OpenIM 推送(si_/sg_ 会话 id)会被路由原样带进来,直接拿去
  // 订阅只会得到一个空会话 —— 归一规则连同理由都在 resolveChatDetailIdentity。
  const { conversationID: paramConversationID, sourceID } = useMemo(
    () =>
      resolveChatDetailIdentity({
        conversationID: params.conversationID,
        sourceID: params.sourceID,
        currentUserID,
      }),
    [params.conversationID, params.sourceID, currentUserID],
  );
  // 有些入口（联系人/群聊列表/报名管理等）只传了 sourceID 没传 conversationID，
  // 这里就地解析会话，避免聊天页停在预览占位。IM 未接通时解析失败 → 保持预览。
  const [resolvedConversationID, setResolvedConversationID] =
    useState(paramConversationID);
  const conversationID = paramConversationID || resolvedConversationID;
  const storedConversationType = useChatStore((state) =>
    state.conversations.find((candidate) => candidate.id === conversationID)?.type,
  );
  const isTempChat =
    params.conversationKind === 'temp' || storedConversationType === 'TEMP';
  // 独立群聊(微信群):GROUP 会话但不挂圈子。circleId 从会话缓存读 ——
  // 从消息列表进来时缓存必有;推送冷启动短暂未知时按圈子群处理,
  // 缓存到位后本判定即时翻转。
  const storedCircleId = useChatStore((state) =>
    state.conversations.find((candidate) => candidate.id === conversationID)
      ?.circleId,
  );
  const membersCanViewRoster = useChatStore((state) =>
    state.conversations.find((candidate) => candidate.id === conversationID)
      ?.policies?.membersCanViewRoster ?? null,
  );
  const isStandaloneGroup =
    storedConversationType === 'GROUP' && storedCircleId === null;
  // 本人被禁言(群主/管理员施加):输入区锁住并说明原因,免得每次都撞服务端拒绝。
  // 到期后的禁言服务端读侧已按未禁言返回;缓存里的旧值在这里再兜一次。
  const selfSilencedFlag = useChatStore((state) =>
    Boolean(
      state.conversations.find((candidate) => candidate.id === conversationID)
        ?.silenced,
    ),
  );
  const selfSilencedUntil = useChatStore(
    (state) =>
      state.conversations.find((candidate) => candidate.id === conversationID)
        ?.silencedUntil ?? null,
  );
  const [silenceClock, setSilenceClock] = useState(() => Date.now());
  useEffect(() => {
    if (!selfSilencedFlag || !selfSilencedUntil) return;
    const expiresAt = new Date(selfSilencedUntil).getTime();
    const remaining = expiresAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      setSilenceClock(Date.now());
      return;
    }
    const timer = setTimeout(() => setSilenceClock(Date.now()), remaining + 1);
    return () => clearTimeout(timer);
  }, [selfSilencedFlag, selfSilencedUntil]);
  const selfSilenced = useMemo(() => {
    if (!selfSilencedFlag) return false;
    if (!selfSilencedUntil) return true;
    const until = new Date(selfSilencedUntil).getTime();
    return Number.isNaN(until) || until > silenceClock;
  }, [selfSilencedFlag, selfSilencedUntil, silenceClock]);
  // 全员禁言:群主/管理员豁免,其余人和被单独禁言一样锁输入区。
  // myRole 缺省(老后端)时按普通成员处理 —— 服务端照样会拒,提前锁住不会更糟。
  const groupMuteAllActive = useChatStore((state) => {
    const conversation = state.conversations.find(
      (candidate) => candidate.id === conversationID,
    );
    if (!conversation?.muteAll) return false;
    return !isGroupManager(conversation.myRole ?? null);
  });
  // 输入区是否锁住:被单独禁言,或全员禁言且自己不是管理员。
  const composerLocked = selfSilenced || groupMuteAllActive;
  const selfDestructEnabled = useChatStore((state) => {
    const conversation = state.conversations.find(
      (candidate) => candidate.id === conversationID,
    );
    return (
      state.viewerSelfDestructSec > 0 ||
      (conversation?.burnDurationSec ?? 0) > 0
    );
  });
  // 与 selfDestructEnabled 分开：那一个还掺了「本人的全局阅后即焚窗口」，那是
  // 我对自己视图的设置，不是发送者对我的承诺。转发 / 收藏的闸只认会话上的焚毁
  // 开关 —— 服务端的转发拒绝也正是按这一条判的。
  const conversationBurnEnabled = useChatStore((state) => {
    const conversation = state.conversations.find(
      (candidate) => candidate.id === conversationID,
    );
    return (conversation?.burnDurationSec ?? 0) > 0;
  });
  const conversationBurnDurationSec = useChatStore((state) => {
    const conversation = state.conversations.find(
      (candidate) => candidate.id === conversationID,
    );
    return conversation?.burnDurationSec ?? 0;
  });
  // 「这张图片能不能落盘」的策略指纹:账号、查看者全局阅后即焚(何时开的)、本会话
  // 焚毁(何时开的)。跨冷启动稳定,只在策略真的变了时才变 —— 图片气泡按它记
  // 「这个策略下清过磁盘缓存」,不能拿每次启动都从 0 重数的 selfDestructPolicyEpoch。
  const selfDestructCacheKey = useChatStore((state) => {
    const conversation = state.conversations.find(
      (candidate) => candidate.id === conversationID,
    );
    const viewer =
      state.viewerSelfDestructSec > 0
        ? `on@${state.viewerSelfDestructStartedAt ?? ''}`
        : 'off';
    const burn =
      (conversation?.burnDurationSec ?? 0) > 0
        ? `on@${conversation?.burnStartedAt ?? ''}`
        : 'off';
    return `${state.currentUserId ?? ''}|viewer:${viewer}|burn:${conversationID}@${burn}`;
  });
  const viewerSelfDestructSec = useChatStore(
    (state) => state.viewerSelfDestructSec,
  );
  const [remoteBurnPolicy, setRemoteBurnPolicy] = useState<{
    burnDurationSec: number | null;
    burnStartedAt: string | null;
  } | null>(null);
  // 只订阅当前会话的消息切片，而非整个 messagesByConversation map。
  // 其他会话来消息时 ingestMessages 会新建顶层对象，但本会话的数组引用不变，
  // zustand 的 Object.is 相等判断因此不会触发本页重渲染——这是聊天页最大的流畅提升。
  const conversationMessages = useChatStore(
    (state) => state.messagesByConversation[conversationID],
  );
  // 对端已读水位(单聊「已读」标记):服务端 chat:read 广播驱动。
  const peerReadHeight = useChatStore((state) =>
    params.conversationType !== 'group' && sourceID
      ? (state.readWatermarks[conversationID]?.[sourceID] ?? 0)
      : 0,
  );
  // 对端送达水位(单聊「已送达」标记,G-07):chat:delivered 广播驱动。
  const peerDeliveredHeight = useChatStore((state) =>
    params.conversationType !== 'group' && sourceID
      ? (state.deliveredWatermarks[conversationID]?.[sourceID] ?? 0)
      : 0,
  );
  const paramTitle =
    typeof params.title === 'string'
      ? params.title
      : t('chat.detail.title', { defaultValue: '聊天详情' });
  const conversationType: ConversationKind =
    params.conversationType === 'group' ? 'group' : 'single';
  const isGroupChat = conversationType === 'group';

  // 权限重查只在页面在前台时兜底轮询,角色变了立刻重查(见 useGroupMemberViewAccess)。
  const isFocused = useIsFocused();
  const cachedRole = useChatStore(
    (state) =>
      state.conversations.find((candidate) => candidate.id === conversationID)
        ?.myRole ?? null,
  );
  const {
    canViewMembers: canViewCircleMembers,
    revalidate: revalidateCircleMemberAccess,
  } = useGroupMemberViewAccess({
      // 独立群聊的 sourceID 是会话 id 而非圈子 id,绝不能拿去请求 /circle/:id。
      enabled: isGroupChat && !isTempChat && !isStandaloneGroup,
      groupID: sourceID,
      currentUserID,
      membersCanViewRoster,
      active: isFocused,
      roleHint: cachedRole,
    });
  // TEMP 不是圈子，不得拿 tmp... groupId 请求 /circle/:uuid。临时房成员目录本身
  // 由 /chat/conversations/:id/members 的座位校验保护，房内成员可直接使用。
  // 独立群聊同理;圈子群由活体角色与「显示群成员」策略共同决定。
  const canViewGroupMemberProfiles =
    isTempChat || isStandaloneGroup || canViewCircleMembers;
  // 「成员可查看他人资料」:三张屏共用 allowsMemberProfiles(群主/管理员豁免;
  // 策略缺省=老后端,按开放处理)。
  const canViewMemberProfilesByPolicy = useChatStore((state) => {
    const conversation = state.conversations.find(
      (candidate) => candidate.id === conversationID,
    );
    return allowsMemberProfiles({
      role: conversation?.myRole,
      policies: conversation?.policies,
    });
  });
  const revalidateMemberViewAccess = useCallback(
    () =>
      isTempChat || isStandaloneGroup
        ? Promise.resolve(true)
        : revalidateCircleMemberAccess(),
    [isTempChat, isStandaloneGroup, revalidateCircleMemberAccess],
  );

  // 单聊标题响应式吃备注覆盖：用户在资料页改备注后即时刷新（参数仅作初始快照）。
  // 非空覆盖 → 用备注；空串（备注被清除）→ 回退到参数快照；未改过 → 用参数快照。
  // 群聊标题不是好友备注，保持参数原值。
  const remarkOverride = useFriendRemarkStore((state) =>
    isGroupChat ? undefined : state.remarks[sourceID],
  );
  const conversationTitle = remarkOverride
    ? remarkOverride.remark ?? remarkOverride.fallbackName ?? paramTitle
    : paramTitle;
  const avatarUrl =
    typeof params.avatarUrl === 'string' ? params.avatarUrl : undefined;
  const searchedMsgID =
    typeof params.searchedMsgID === 'string' ? params.searchedMsgID : '';
  const isPreviewMode = !conversationID;

  // 入口只给了 sourceID 时，就地把会话解析出来（单聊按对端 userID、群聊按圈子 id）。
  // 独立群聊的 sourceID 就是会话 id,没有「按圈子 get-or-create」一说 —— 它的
  // 入口(消息列表/推送)都带 conversationID,走不到这里。
  useEffect(() => {
    if (paramConversationID || !sourceID || isTempChat || isStandaloneGroup)
      return;
    let cancelled = false;
    (async () => {
      try {
        const conv = isGroupChat
          ? await ensureCircleConversation(sourceID)
          : await ensureDirectConversation(sourceID);
        if (!cancelled) setResolvedConversationID(conv.conversationID);
      } catch (error) {
        // 未连通等：保持预览模式，不阻断页面。
        reportHandledFailure('chatDetail', 'resolveConversation', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paramConversationID, sourceID, isGroupChat, isTempChat, isStandaloneGroup]);

  return {
    sourceID,
    conversationID,
    isTempChat,
    selfSilencedUntil,
    selfSilenced,
    composerLocked,
    selfDestructEnabled,
    conversationBurnEnabled,
    conversationBurnDurationSec,
    selfDestructCacheKey,
    viewerSelfDestructSec,
    remoteBurnPolicy,
    setRemoteBurnPolicy,
    conversationMessages,
    peerReadHeight,
    peerDeliveredHeight,
    conversationType,
    isGroupChat,
    canViewGroupMemberProfiles,
    canViewMemberProfilesByPolicy,
    revalidateMemberViewAccess,
    conversationTitle,
    avatarUrl,
    searchedMsgID,
    isPreviewMode,
  };
}
