import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '@/constants/config';

type NetworkStatus = {
  isOffline: boolean;
};

let cachedOnline = true;
const NETWORK_PROBE_URL = `${API_URL}/auth/me`;

/**
 * 探测客户端是否能到达后端。
 *
 * 之前用 `clients3.google.com/generate_204` 做探测 —— Google 的 captive portal 端点。
 * 但这个域名在国内被墙，对所有国内用户来说，探测永远失败 → 4 个商城/钱包/收藏屏永远展示
 * 「网络异常」横幅，把整套页面砸成一坨。
 *
 * 改用应用自己的后端接口做 HEAD 探测：既测了真正关心的"我能访问后端吗"，又顺便规避了
 * GFW 问题。探测 `/auth/me` 而不是 `/api/v1` 根路径，是因为后端没有根路径 handler，
 * 会刷 `Cannot HEAD /api/v1` WARN。未登录时 401 也说明 TCP/HTTP 通路打通，对"是否在线"足够。
 * 真正断网时 fetch 抛 TypeError；5xx 是后端故障但网络在 —— 也算 online，让 UI 不要误报。
 */
async function probe(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(NETWORK_PROBE_URL, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // 任何能拿到 status 的响应都算 TCP 通了 —— 包括 4xx/5xx（后端有故障但网络在）。
    return response.status > 0;
  } catch {
    return false;
  }
}

export function useNetworkStatus(): NetworkStatus {
  const [isOffline, setIsOffline] = useState(!cachedOnline);

  useEffect(() => {
    let active = true;

    const check = async () => {
      const online = await probe();
      cachedOnline = online;
      if (active) {
        setIsOffline(!online);
      }
    };

    check();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        check();
      }
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return { isOffline };
}
