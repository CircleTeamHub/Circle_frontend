import type { Href } from 'expo-router';
import {
  APP_LINK_PROTOCOLS,
  APP_UNIVERSAL_LINK_HOSTS,
} from '../../../constants/branding';
import { parseQrToken } from '../../qr/qr-payload';

type MessageScanAction =
  | { type: 'route'; href: Href }
  | { type: 'copy'; value: string };

// as const + satisfies：值类型收窄成 5 个字符串字面量(而不是整个 Href 巨型
// 联合),索引表达式不再触发 TS2590,同时保留「必须是合法路由」的校验。
const MESSAGE_ROUTE_MAP = {
  'add-friend': '/(tabs)/messages/add-friend',
  find: '/(tabs)/messages/find',
  groups: '/(tabs)/messages/groups',
  'temp-chats': '/(tabs)/messages/temp-chats',
} as const satisfies Record<string, Href>;

const APP_LINK_PROTOCOL_SET = new Set<string>(APP_LINK_PROTOCOLS);
const APP_LINK_HOST_SET = new Set<string>(APP_UNIVERSAL_LINK_HOSTS);

function normalizeMessagePath(rawValue: string): string | null {
  const value = rawValue.trim();

  if (value.startsWith('/(tabs)/messages/')) {
    return value.slice('/(tabs)/messages/'.length).split(/[?#/]/)[0] || null;
  }

  if (value.startsWith('/messages/')) {
    return value.slice('/messages/'.length).split(/[?#/]/)[0] || null;
  }

  try {
    const url = new URL(value);

    if (APP_LINK_PROTOCOL_SET.has(url.protocol)) {
      const segments = [url.hostname, ...url.pathname.split('/').filter(Boolean)];
      return segments[0] === 'messages' ? segments[1] ?? null : null;
    }

    if (
      url.protocol === 'https:' &&
      APP_LINK_HOST_SET.has(url.hostname)
    ) {
      const segments = url.pathname.split('/').filter(Boolean);
      return segments[0] === 'messages' ? segments[1] ?? null : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveMessageScanResult(data: string): MessageScanAction {
  const value = data.trim();

  // 二维码令牌(名片/群/圈子)优先:扫到本应用的 qr 载荷直接进落地页,
  // 由落地页 resolve 预览 + 用户确认后再执行加入。
  const qrToken = parseQrToken(value);
  if (qrToken) {
    return {
      type: 'route',
      href: { pathname: '/qr', params: { t: qrToken } },
    };
  }

  const messagePath = normalizeMessagePath(value);
  const href = messagePath
    ? MESSAGE_ROUTE_MAP[messagePath as keyof typeof MESSAGE_ROUTE_MAP]
    : undefined;

  if (href) {
    return { type: 'route', href };
  }

  return { type: 'copy', value };
}
