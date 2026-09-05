import { Image } from 'expo-image';
import { createVideoPlayer, type VideoThumbnail } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

// A single queue prevents a large selection from keeping many decoders alive at once.
let thumbnailWork = Promise.resolve();

function generateThumbnail(uri: string) {
  const work = thumbnailWork.then(async () => {
    const player = createVideoPlayer(uri);
    try {
      return (await player.generateThumbnailsAsync(0, { maxWidth: 320 }))[0] ?? null;
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
