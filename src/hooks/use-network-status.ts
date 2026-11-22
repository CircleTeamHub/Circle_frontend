import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '@/constants/config';

type NetworkStatus = {
  isOffline: boolean;
};

let cachedOnline = true;
// 后端的存活探针 /healthz:挂在 api/v1 前缀之外,不鉴权、不过应用层限流、不记请求日志,
// 线上 Caddy 也有意把它留在公网(给外部 uptime 监控)。
const NETWORK_PROBE_URL = `${API_URL.replace(/^(https?:\/\/[^/]+).*$/, '$1')}/healthz`;

/**
 * 探测客户端是否能到达后端。
 *
 * 之前用 `clients3.google.com/generate_204` 做探测 —— Google 的 captive portal 端点。
 * 但这个域名在国内被墙，对所有国内用户来说，探测永远失败 → 4 个商城/钱包/收藏屏永远展示
 * 「网络异常」横幅，把整套页面砸成一坨。
 *
 * 改用应用自己的后端做 HEAD 探测。原来探的是 `/auth/me`:未登录、或网页刷新后令牌还没恢复时,
 * 每次都是一条 401,还占着后端每 IP 300 次/分钟的全局限流额度。现在探 /healthz。
 *
 * 网页跨域、/healthz 不带 CORS 头:用 no-cors,拿到的是 opaque 响应(status 0),能拿到就说明
 * 通了。任何能拿到的响应都算在线 —— 包括 4xx/5xx(后端有故障但网络在),让 UI 不要误报;
 * 真正断网时 fetch 抛 TypeError。
 */
export async function probeBackendReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(NETWORK_PROBE_URL, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.type === 'opaque' || response.status > 0;
  } catch {
    return false;
  }
}

export function useNetworkStatus(): NetworkStatus {
  const [isOffline, setIsOffline] = useState(!cachedOnline);

  useEffect(() => {
    let active = true;

    const check = async () => {
      const online = await probeBackendReachable();
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
