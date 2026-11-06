import type { VideoSourceObject } from 'expo-video';

/** Keep signed requests intact; only the native cache identity omits COS/S3 credentials. */
export function cachedVideoSource(uri: string, persist = true): VideoSourceObject {
  if (!persist || !/^https?:\/\//i.test(uri)) return { uri, useCaching: false };
  const identity = new URL(uri);
  for (const name of Array.from(identity.searchParams.keys())) {
    if (/^(x-amz-|x-cos-security-token$|q-sign-|q-signature$|q-ak$|q-key-time$|q-header-list$|q-url-param-list$)/i.test(name)) {
      identity.searchParams.delete(name);
    }
  }
  identity.hash = '';
  // Adaptive manifests have their own per-segment cache keys in the native player.
  return /\.(m3u8|mpd)$/i.test(identity.pathname)
    ? { uri, useCaching: false }
    : { uri, useCaching: true, cacheKey: `video:${identity.toString()}` };
}
