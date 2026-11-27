import { Image } from 'expo-image';
import { createVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { withThumbnailTimeout } from '@/features/notes/utils/thumbnail-timeout';

// A single queue prevents a large selection from keeping many decoders alive at once.
let thumbnailWork = Promise.resolve();

/**
 * 等视频真正挂到播放器上再截帧。iOS 上 createVideoPlayer(uri) 在后台任务里挂视频，
 * replaceAsync 也只等到资源加载完、挂视频那一步又被丢回主线程异步做，promise 先回来；
 * 这时截帧拿到的是空数组（没有 currentItem），画面就一直是黑块，而且时好时坏。
 * readyToPlay 才说明视频已挂上、时长也读到了。
 */
function loadForThumbnail(player: VideoPlayer, uri: string) {
  return new Promise<void>((resolve, reject) => {
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        subscription.remove();
        resolve();
      } else if (status === 'error') {
        subscription.remove();
        reject(new Error(error?.message ?? 'video failed to load'));
      }
    });
    player.replaceAsync(uri).then(
      () => {
        if (player.status === 'readyToPlay') {
          subscription.remove();
          resolve();
        }
      },
      (error: unknown) => {
        subscription.remove();
        reject(error);
      },
    );
  });
}

function generateThumbnail(uri: string) {
  const work = thumbnailWork.then(async () => {
    const player = createVideoPlayer(null);
    const pending = loadForThumbnail(player, uri)
      // 很多视频第一帧是黑的（淡入、相机刚启动），够长就取第 0.5 秒。
      .then(() => player.generateThumbnailsAsync(player.duration > 1 ? 0.5 : 0, { maxWidth: 320 }))
      .then((thumbnails) => thumbnails[0] ?? null);
    try {
      // 队列是串行的：一个解不开的视频把原生调用挂住，后面每一个缩略图都永远
      // 排在它后面 —— 整列预览停在占位方块上，既不报错也不重试。超时只放弃
      // 这一格，让队列继续走。
      return await withThumbnailTimeout(pending, (late) => late.release());
    } finally {
      player.release();
    }
  });
  thumbnailWork = work.then(
    () => undefined,
    () => undefined,
  );
  return work;
}

export function VideoDraftPreview({ uri }: { uri: string }) {
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null);
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const thumbnailRef = useRef<VideoThumbnail | null>(null);

  useEffect(() => {
    let cancelled = false;
    const releaseThumbnail = (value: VideoThumbnail | null) => {
      if (!value) return;
      value.release();
    };
    const releaseCurrentThumbnail = () => {
      const current = thumbnailRef.current;
      thumbnailRef.current = null;
      releaseThumbnail(current);
    };

    releaseCurrentThumbnail();
    setThumbnail(null);
    setThumbnailUri(null);
    void generateThumbnail(uri)
      .then((nextThumbnail) => {
        if (cancelled) {
          releaseThumbnail(nextThumbnail);
          return;
        }
        thumbnailRef.current = nextThumbnail;
        setThumbnail(nextThumbnail);
        setThumbnailUri(uri);
      })
      .catch(() => {
        // Keep the neutral fallback if the device cannot decode this local video.
      });
    return () => {
      cancelled = true;
      releaseCurrentThumbnail();
    };
  }, [uri]);

  if (!thumbnail || thumbnailUri !== uri) {
    return <View testID="note-media-preview-video-loading" style={s.fallback} />;
  }
  return <Image testID="note-media-preview-video" source={thumbnail} style={s.image} contentFit="cover" />;
}

const s = StyleSheet.create({
  image: { width: '100%', height: '100%' },
  fallback: { width: '100%', height: '100%', backgroundColor: '#000' },
});
