import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { topNotice } from '@/components/app/top-notice-store';
import { reportHandledFailure } from '@/observability/report-failure';
import {
  circleOfflinePushAllowed,
  useCircleNotificationStore,
  type CircleNotificationPreferences,
} from '@/features/discover/store/use-circle-notification-store';
import {
  fetchCircleOfflinePushEnabled,
  updateCircleOfflinePushEnabled,
} from '@/services/api/notifications';

/**
 * 圈子通知三档开关的全部行为：读、写、回滚、失败提示。
 *
 * 为什么是一个 hook 而不是各页面各写一遍：横幅 / 声音 / 红点是本机行为，读 store
 * 就够；但「离线提醒」由服务端执行，本地只是镜像 —— 漏掉同步的那个页面会给用户
 * 一个关了其实没关的开关（个人设置页此前就是这样）。把同步收进唯一入口，新增
 * 承载容器时不可能忘。
 *
 * 三档的语义（总闸关了子项算不算数）仍然只在 store 的 selector 里表达一次，
 * 这里不重复拼与运算。
 */

/** 只保留写进服务端的那一格所依赖的两档，声音不进服务端。 */
type SyncedPreferences = Pick<
  CircleNotificationPreferences,
  'globalEnabled' | 'offlineEnabled'
>;

export interface CircleNotificationTiers {
  globalEnabled: boolean;
  soundEnabled: boolean;
  offlineEnabled: boolean;
  /** 子档的展示值 —— 总闸关着时一律显示为关。 */
  soundValue: boolean;
  offlineValue: boolean;
  setGlobalEnabled: (value: boolean) => void;
  setSoundEnabled: (value: boolean) => void;
  setOfflineEnabled: (value: boolean) => void;
}

function syncedSnapshot(state: SyncedPreferences): SyncedPreferences {
  return {
    globalEnabled: state.globalEnabled,
    offlineEnabled: state.offlineEnabled,
  };
}

export function useCircleNotificationTiers(): CircleNotificationTiers {
  const { t } = useTranslation();

  const globalEnabled = useCircleNotificationStore((st) => st.globalEnabled);
  const soundEnabled = useCircleNotificationStore((st) => st.soundEnabled);
  const offlineEnabled = useCircleNotificationStore((st) => st.offlineEnabled);
  const setSoundEnabled = useCircleNotificationStore((st) => st.setSoundEnabled);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // 最后一次被服务端确认过的那对本地取值。失败回滚回滚到它，而不是回滚到
  // 「取反」—— 连点两下之后取反已经不是用户出发的那个状态了。
  const confirmedRef = useRef<SyncedPreferences | null>(null);
  // 请求序号：只有最新那一发的结果算数，迟到的响应一律丢弃，否则两次快速点击
  // 谁后回来谁说了算，本地会停在与服务端相反的那一格。
  const latestRequestRef = useRef(0);
  // PATCH 不能并发：忽略旧响应只保护本地 UI，旧请求若最后才在服务端落库，仍会
  // 覆盖用户的新选择。用一条写队列保证服务端也按点击顺序看到每个状态。
  const writeTailRef = useRef<Promise<void> | null>(null);

  // 打开设置时以服务端为准校一次：离线推送的真值在后端，本地只是镜像，换设备
  // 或异地改过之后本地可能已经不对。失败沿用本地值，不打断用户，但要留痕 ——
  // 静默吞掉的话，「关了还在推」这类反馈永远查不到是哪一步断的。
  useEffect(() => {
    let cancelled = false;
    void fetchCircleOfflinePushEnabled()
      .then((enabled) => {
        if (cancelled || !mountedRef.current) return;
        // 用户在响应回来之前已经动过开关：他的意图比这个旧快照新，不许反写。
        if (latestRequestRef.current > 0) return;
        const state = useCircleNotificationStore.getState();
        // 总闸关着时服务端一定是 false，那是总闸的结果，不该反写掉用户的离线档选择。
        if (state.globalEnabled) state.setOfflineEnabled(enabled);
      })
      .catch((err) => {
        reportHandledFailure('circleNotification', 'offlinePushFetch', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 把「生效的离线推送值」推给后端。失败要回滚本地开关 —— 留着一个说关了其实
  // 没关的开关，比报错更糟。
  const syncOfflinePush = useCallback(
    (apply: () => void) => {
      const before = syncedSnapshot(useCircleNotificationStore.getState());
      confirmedRef.current ??= before;
      apply();

      const requestId = latestRequestRef.current + 1;
      latestRequestRef.current = requestId;
      const next = circleOfflinePushAllowed(
        useCircleNotificationStore.getState(),
      );

      const write = () =>
        updateCircleOfflinePushEnabled(next).then(() => {
          if (requestId !== latestRequestRef.current) return;
          // 这一发是最新的且写成了：当前本地取值就是服务端的取值。
          confirmedRef.current = null;
        })
        .catch((err) => {
          reportHandledFailure('circleNotification', 'offlinePushSync', err);
          if (requestId !== latestRequestRef.current || !mountedRef.current) {
            return;
          }
          const confirmed = confirmedRef.current ?? before;
          confirmedRef.current = null;
          const store = useCircleNotificationStore.getState();
          store.setGlobalEnabled(confirmed.globalEnabled);
          store.setOfflineEnabled(confirmed.offlineEnabled);
          topNotice.error(t('discover.notifications.syncFailed'));
        });

      const previous = writeTailRef.current;
      let tail: Promise<void>;
      tail = (previous ? previous.then(write, write) : write()).finally(() => {
        if (writeTailRef.current === tail) writeTailRef.current = null;
      });
      writeTailRef.current = tail;
      void tail;
    },
    [t],
  );

  const handleGlobalToggle = useCallback(
    (value: boolean) =>
      syncOfflinePush(() =>
        useCircleNotificationStore.getState().setGlobalEnabled(value),
      ),
    [syncOfflinePush],
  );

  const handleOfflineToggle = useCallback(
    (value: boolean) =>
      syncOfflinePush(() =>
        useCircleNotificationStore.getState().setOfflineEnabled(value),
      ),
    [syncOfflinePush],
  );

  return {
    globalEnabled,
    soundEnabled,
    offlineEnabled,
    soundValue: globalEnabled && soundEnabled,
    offlineValue: globalEnabled && offlineEnabled,
    setGlobalEnabled: handleGlobalToggle,
    setSoundEnabled,
    setOfflineEnabled: handleOfflineToggle,
  };
}
