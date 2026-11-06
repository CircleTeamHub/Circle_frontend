import { Image, type ImageProps } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MediaProgressBar } from './media-progress-bar';

/** Media keeps its layout while the actual download reports its byte progress. */
export function MediaImage({ style, onLoadStart, onProgress, onLoadEnd, onDisplay, onError, ...props }: ImageProps) {
  const [progress, setProgress] = useState<number | null | false>(false);
  const percent = typeof progress === 'number' ? Math.floor(progress * 100) : null;
  return (
    <View style={[style, s.frame]}>
      <Image
        cachePolicy="memory-disk"
        transition={0}
        {...props}
        style={StyleSheet.absoluteFill}
        onLoadStart={() => { setProgress(null); onLoadStart?.(); }}
        onProgress={(event) => {
          setProgress(event.total > 0 ? Math.min(1, event.loaded / event.total) : null);
          onProgress?.(event);
        }}
        onLoadEnd={() => { setProgress(false); onLoadEnd?.(); }}
        onDisplay={() => { setProgress(false); onDisplay?.(); }}
        onError={(event) => { setProgress(false); onError?.(event); }}
      />
      {progress !== false ? (
        <View style={s.overlay} pointerEvents="none" accessible accessibilityRole="progressbar"
          accessibilityState={{ busy: true }} accessibilityValue={percent === null ? {} : { min: 0, max: 100, now: percent }}>
          <View style={s.badge}>
            {percent === null ? null : <Text style={s.label}>{percent}%</Text>}
            <MediaProgressBar percent={percent} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { overflow: 'hidden' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  badge: { minWidth: 64, padding: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center' },
  label: { color: '#fff', fontSize: 12, lineHeight: 18 },
});
