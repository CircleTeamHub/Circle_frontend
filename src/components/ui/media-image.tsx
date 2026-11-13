import { Image, type ImageProps } from 'expo-image';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MediaProgressBar } from './media-progress-bar';

/**
 * 开始加载后等这么久还没显示,才挂下载进度。
 *
 * 每张图挂上(包括聊天记录里滑进来的每一张)都会先发 loadStart,缓存命中的图紧接着就显示。
 * 原来 loadStart 立刻挂进度遮罩、起循环动画,显示时再拆掉:每张图多渲染两遍、起停一次动画,
 * 划过一串图片时这些都挤在滚动的那几帧里。真在下载的图过了这段才显示进度,看起来没有区别。
 */
export const MEDIA_PROGRESS_DELAY_MS = 300;

type Progress = number | null | false;

interface MediaImageProps extends ImageProps {
  /** 画在图片上、下载进度下面(比如视频封面的播放键):下载中被进度盖住,显示后露出来。 */
  overlay?: ReactNode;
}

/** Media keeps its layout while the actual download reports its byte progress. */
export function MediaImage({ style, overlay, onLoadStart, onProgress, onLoadEnd, onDisplay, onError, ...props }: MediaImageProps) {
  // 整数百分比 / null(总字节未知,走动画条) / false(不显示)。存整数:同一个百分比内的
  // 进度事件 setState 同值,React 直接跳过,不重渲染。
  const [progress, setProgress] = useState<Progress>(false);
  // 等待期间收到的进度先记着,到点显示时直接是最新值。
  const pendingRef = useRef<Progress>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const finish = () => {
    clearTimer();
    pendingRef.current = false;
    shownRef.current = false;
    setProgress(false);
  };
  useEffect(() => clearTimer, []);

  return (
    <View style={[style, s.frame]}>
      <Image
        cachePolicy="memory-disk"
        transition={0}
        {...props}
        style={StyleSheet.absoluteFill}
        onLoadStart={() => {
          clearTimer();
          pendingRef.current = null;
          if (shownRef.current) setProgress(null);
          else {
            timerRef.current = setTimeout(() => {
              timerRef.current = null;
              shownRef.current = true;
              setProgress(pendingRef.current);
            }, MEDIA_PROGRESS_DELAY_MS);
          }
          onLoadStart?.();
        }}
        onProgress={(event) => {
          const next = event.total > 0 ? Math.floor(Math.min(1, event.loaded / event.total) * 100) : null;
          pendingRef.current = next;
          if (shownRef.current) setProgress(next);
          onProgress?.(event);
        }}
        onLoadEnd={() => { finish(); onLoadEnd?.(); }}
        onDisplay={() => { finish(); onDisplay?.(); }}
        onError={(event) => { finish(); onError?.(event); }}
      />
      {overlay}
      {progress !== false ? (
        <View style={s.overlay} pointerEvents="none" accessible accessibilityRole="progressbar"
          accessibilityState={{ busy: true }} accessibilityValue={progress === null ? {} : { min: 0, max: 100, now: progress }}>
          <View style={s.badge}>
            {progress === null ? null : <Text style={s.label}>{progress}%</Text>}
            <MediaProgressBar percent={progress} />
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
