import type { Href } from 'expo-router';

type MessageScanAction =
  | { type: 'route'; href: Href }
  | { type: 'copy'; value: string };

const MESSAGE_ROUTE_MAP: Record<string, Href> = {
  'add-friend': '/(tabs)/messages/add-friend',
  find: '/(tabs)/messages/find',
  groups: '/(tabs)/messages/groups',
  'new-group': '/(tabs)/messages/new-group',
  'temp-chats': '/(tabs)/messages/temp-chats',
};

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

    if (url.protocol === 'circleim:') {
      const segments = [url.hostname, ...url.pathname.split('/').filter(Boolean)];
      return segments[0] === 'messages' ? segments[1] ?? null : null;
    }

    if (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      (url.hostname === 'circle.im' || url.hostname === 'www.circle.im')
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
  const messagePath = normalizeMessagePath(value);
  const href = messagePath ? MESSAGE_ROUTE_MAP[messagePath] : undefined;

  if (href) {
    return { type: 'route', href };
  }

  return { type: 'copy', value };
}
