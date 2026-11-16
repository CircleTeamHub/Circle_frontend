import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { captureVideoPosterFrame } from '@/features/chat/utils/chat-video-poster';
import { withThumbnailTimeout } from '@/features/notes/utils/thumbnail-timeout';

/** 截到的本机 JPEG;null = 截不到(坏文件、超时),同一条视频不再试。 */
const frames = new Map<string, string | null>();
const MAX_REMEMBERED_FRAMES = 200;
/** 还挂在屏幕上、等着某条视频那一帧的气泡数。划走了就别再排队截它。 */
const waiting = new Map<string, number>();
const inFlight = new Map<string, Promise<string | null>>();
// 一次只截一条:每次都要起一个解码器(远端视频还要先拉一截下来),并发起来手机吃不消。
let queue: Promise<unknown> = Promise.resolve();

function remember(key: string, uri: string | null) {
  frames.delete(key);
  frames.set(key, uri);
  if (frames.size > MAX_REMEMBERED_FRAMES) {
    const oldest = frames.keys().next().value;
    if (oldest !== undefined) frames.delete(oldest);
  }
}

function requestFrame(key: string, videoUri: string): Promise<string | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const work = queue.then(async () => {
    // 排到时气泡已经划出屏幕:不截、也不记失败,下次划回来再排。
    if (!waiting.has(key)) return null;
    const frame = await withThumbnailTimeout(captureVideoPosterFrame(videoUri, undefined), () => undefined);
    remember(key, frame?.uri ?? null);
    return frame?.uri ?? null;
  });
  queue = work.catch(() => undefined);
  inFlight.set(key, work);
  void work.finally(() => inFlight.delete(key));
  return work;
}

/**
 * 没有封面的视频气泡在本机补截一帧:老消息、封面截失败或超时的、正在上传还没封面的
 * (那时 videoUrl 是本机文件,截起来很快)。不然气泡是一块黑,看不出发的是哪个视频。
 *
 * - key 要跨「发送中 → 已送达」保持不变(用 deliveryId),签名地址每小时轮换,不能当 key。
 * - 阅后即焚的消息不截:截出来的 JPEG 会落进缓存目录。
 * - Web 不截:expo-video 在 Web 上没有截帧,只会白白把视频拉下来。
 */
export function useVideoFrameFallback(
  videoUri: string | undefined,
  key: string | undefined,
  enabled: boolean,
): string | undefined {
  const active = enabled && Platform.OS !== 'web' && Boolean(videoUri) && Boolean(key);
  const activeKey = active ? key : undefined;
  const [frame, setFrame] = useState<{ key: string; uri: string } | null>(null);

  useEffect(() => {
    if (!activeKey || !videoUri) return;
    const known = frames.get(activeKey);
    if (known !== undefined) {
      setFrame(known ? { key: activeKey, uri: known } : null);
      return;
    }
    let mounted = true;
    waiting.set(activeKey, (waiting.get(activeKey) ?? 0) + 1);
    void requestFrame(activeKey, videoUri).then((uri) => {
      if (mounted && uri) setFrame({ key: activeKey, uri });
    });
    return () => {
      mounted = false;
      const count = (waiting.get(activeKey) ?? 1) - 1;
      if (count > 0) waiting.set(activeKey, count);
      else waiting.delete(activeKey);
    };
  }, [activeKey, videoUri]);

  if (!activeKey) return undefined;
  if (frame?.key === activeKey) return frame.uri;
  return frames.get(activeKey) ?? undefined;
}
