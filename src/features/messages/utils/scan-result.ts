import type { Href } from 'expo-router';
import {
  APP_LINK_PROTOCOLS,
  APP_UNIVERSAL_LINK_HOSTS,
} from '../../../constants/branding';
import { parseQrLoginToken, parseQrToken } from '../../qr/qr-payload';

type MessageScanAction =
  | { type: 'route'; href: Href }
  | { type: 'copy'; value: string };

// 扫码页在消息、通讯录两个栈各有一份,结果页也都在两个栈里,扫完留在本栈。
export type ScanScope = 'messages' | 'contacts';

const SCAN_ROUTE_PAGES = new Set(['add-friend', 'find', 'temp-chats']);
// 消息栈的 groups 是分组管理,通讯录栈的 groups 是「我的群聊」,不是同一页:只能进消息栈那份。
const MESSAGE_GROUPS_HREF = '/(tabs)/messages/groups' satisfies Href;

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

export function resolveMessageScanResult(data: string, scope: ScanScope): MessageScanAction {
  const value = data.trim();

  // 这里的结果由 ScanScreen 用 router.replace 消费:落地页必须留在扫码页所在的栈内。
  // 跳去顶层的 /qr、/qr-login 会把整个 messages 栈换掉,加好友申请走完之后落地页
  // 就没有可返回的目标了。外部系统相机扫出来的深链另走顶层路由,不经过这里。
  const loginToken = parseQrLoginToken(value);
  if (loginToken) {
    return {
      type: 'route',
      href: {
        pathname: `/(tabs)/${scope}/qr-login`,
        params: { t: loginToken },
      },
    };
  }

  // 二维码令牌(名片/群/圈子)优先:扫到本应用的 qr 载荷直接进落地页,
  // 由落地页 resolve 预览 + 用户确认后再执行加入。
  const qrToken = parseQrToken(value);
  if (qrToken) {
    return {
      type: 'route',
      href: { pathname: `/(tabs)/${scope}/qr`, params: { t: qrToken } },
    };
  }

  const messagePath = normalizeMessagePath(value);
  if (messagePath === 'groups') {
    return { type: 'route', href: MESSAGE_GROUPS_HREF };
  }
  if (messagePath && SCAN_ROUTE_PAGES.has(messagePath)) {
    return { type: 'route', href: `/(tabs)/${scope}/${messagePath}` as Href };
  }

  return { type: 'copy', value };
}
