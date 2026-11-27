import { Image } from 'expo-image';
import { createVideoPlayer, type VideoThumbnail } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { loadVideoForThumbnail } from '@/features/chat/utils/chat-video-poster';
import { withThumbnailTimeout } from '@/features/notes/utils/thumbnail-timeout';
import { reportHandledFailure } from '@/observability/report-failure';

// A single queue prevents a large selection from keeping many decoders alive at once.
let thumbnailWork = Promise.resolve();

function generateThumbnail(uri: string) {
  const work = thumbnailWork.then(async () => {
    const player = createVideoPlayer(null);
    // 等视频真正挂上播放器再截帧（iOS 上 replaceAsync 先于挂视频返回，早截只拿到空数组）；
    // 加载超时后也不会再碰已释放的播放器。和聊天封面共用一套。
    const pending = loadVideoForThumbnail(player, uri)
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
      .catch((error: unknown) => {
        // 保留黑色占位；重开的笔记里视频是远端地址，慢网加载不出来也走这里，要能在线上看到。
        reportHandledFailure('noteVideoPreview', 'captureFrame', error);
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
