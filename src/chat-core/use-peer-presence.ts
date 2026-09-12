import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeLastSeen, LAST_SEEN_LABEL_KEYS } from './last-seen';
import { useChatStore } from './store';

/** 「N 分钟前在线」的刷新节拍:文案只显示到分钟,更密没有意义。 */
const LAST_SEEN_TICK_MS = 60_000;

export interface PeerPresence {
  /**
   * 是否拿到过此人的状态。对方关了「显示在线时间」、还没查到、或与本人不同处
   * 任何会话时为 false —— 界面应当什么都不画,画「离线」仍是在泄露信息。
   */
  known: boolean;
  online: boolean;
  /** 「在线」/「N 分钟前在线」/「离线」;known 为 false 时为空串。 */
  label: string;
}

/**
 * 某个用户的在线状态 + 文案(聊天头部等处共用)。
 * 只订阅这一位的切片,别人上下线不触发重渲染;离线且有最近在线时刻时每分钟
 * 刷一次文案。查询本身由页面在进页时发(queryChatPresence),这里只消费 store。
 */
export function usePeerPresence(userId: string | null): PeerPresence {
  const { t } = useTranslation();
  const online = useChatStore((state) =>
    userId != null ? state.onlineByUser[userId] : undefined,
  );
  const lastSeenAt = useChatStore((state) =>
    userId != null ? (state.lastSeenByUser[userId] ?? null) : null,
  );
  const ticking = online === false && lastSeenAt !== null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    // 立刻对齐一次:换了人或刚下线时沿用上一轮的 now 会让首帧差一分钟。
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), LAST_SEEN_TICK_MS);
    return () => clearInterval(timer);
  }, [ticking, lastSeenAt]);

  const label = useMemo(() => {
    if (online === undefined) return '';
    if (online) return t('chat.detail.statusOnline', { defaultValue: '在线' });
    const bucket = describeLastSeen(lastSeenAt, now);
    if (!bucket) return t('chat.detail.statusOffline', { defaultValue: '离线' });
    return t(LAST_SEEN_LABEL_KEYS[bucket.unit], { count: bucket.count });
  }, [lastSeenAt, now, online, t]);

  return { known: online !== undefined, online: online === true, label };
}
