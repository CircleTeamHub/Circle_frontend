import { reportHandledFailure } from '@/observability/report-failure';
import { fetchNewMomentsCount } from '@/services/api/moments';
import { readPageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';
import { useAuthStore } from '@/stores/authStore';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

/**
 * 探索 tab 的「好友有新动态」小红点。好友发朋友圈不弹系统推送，只亮这个点（同微信）。
 *
 * 水位 = 这台设备上次刷新朋友圈 feed 的时间，存在账号作用域的页面快照里（登出随快照一起清；
 * Web 端快照不落盘，只记在内存）。服务端 poke（moments.feed.updated）和每次认证成功都来问
 * 一次「水位之后好友发了几条」。只是一个点，不计数。
 */
const SEEN_KEY = 'social:moments-seen-at';
const CHECK_DEBOUNCE_MS = 800;

let memorySeen: { userId: string; at: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function readSeenAt(userId: string): string | null {
  if (memorySeen?.userId === userId) return memorySeen.at;
  const saved = readPageSnapshot<unknown>(userId, SEEN_KEY)?.value;
  return typeof saved === 'string' ? saved : null;
}

function writeSeenAt(userId: string, at: string): void {
  memorySeen = { userId, at };
  writePageSnapshot(userId, SEEN_KEY, at);
}

/** 朋友圈 feed 刷新成功：刷到的就是看过的，水位推到这次刷新，红点熄掉。 */
export function markMomentsSeen(at: string): void {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  writeSeenAt(userId, at);
  useTabBadgeStore.getState().setMomentsHasUpdate(false);
}

/** 尾沿去抖：一批好友接连发帖的 poke 合并成一次查询。 */
export function scheduleMomentsUpdateCheck(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void checkMomentsUpdate();
  }, CHECK_DEBOUNCE_MS);
}

export async function checkMomentsUpdate(): Promise<void> {
  const { user, sessionEpoch, isAuthenticated } = useAuthStore.getState();
  if (!isAuthenticated || !user?.id) return;
  const since = readSeenAt(user.id);
  if (!since) {
    // 这台设备上还没刷过朋友圈：从现在起算，之后好友发的才亮。
    writeSeenAt(user.id, new Date().toISOString());
    return;
  }
  try {
    const count = await fetchNewMomentsCount(since, { friendsOnly: true });
    const auth = useAuthStore.getState();
    if (auth.sessionEpoch !== sessionEpoch || auth.user?.id !== user.id) return;
    // 查询在飞时刷过 feed：水位已经往后挪，这次的结果作废。
    if (readSeenAt(user.id) !== since) return;
    useTabBadgeStore.getState().setMomentsHasUpdate(count > 0);
  } catch (error) {
    reportHandledFailure('moments', 'checkUpdate', error);
  }
}
