import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MediaImage } from '@/components/ui/media-image';
import { MediaProgressBar } from '@/components/ui/media-progress-bar';
import {
  SWIPE_CLAIM_DISTANCE,
  SWIPE_DISMISS_DISTANCE,
  SWIPE_DISMISS_VELOCITY,
} from '@/components/ui/zoomable-image';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography } from '@/theme';
import { cachedVideoSource } from '@/utils/video-source';

/** 系统播放器底部控件条的高度：暂停时手势层不盖这块，进度条还能拖。 */
const NATIVE_CONTROL_BAR_HEIGHT = 96;

interface ViewerVideoPlayerProps {
  videoUrl: string;
  ephemeral: boolean;
  poster: ReactNode;
  onPlayingChange: (playing: boolean) => void;
}

/** 只在这一页开始播放后挂载；useVideoPlayer 卸载时释放解码器。 */
function ViewerVideoPlayer({ videoUrl, ephemeral, poster, onPlayingChange }: ViewerVideoPlayerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [firstFrameShown, setFirstFrameShown] = useState(false);
  const endedRef = useRef(false);
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const report = (next: boolean) => {
      setPlaying(next);
      onPlayingChangeRef.current(next);
    };
    const subscriptions = [
      player.addListener('statusChange', ({ status }) => {
        if (cancelled) return;
        // 安卓播完后状态回到 idle，那不是在加载。
        setLoading((status === 'loading' || status === 'idle') && !endedRef.current);
        if (status === 'error') {
          setFailed(true);
          setLoading(false);
          report(false);
          reportHandledFailure('mediaViewer', 'videoPlayback', new Error('Video playback failed'));
        } else if (status !== 'loading' && !player.playing) {
          // 缓冲期间按了暂停：缓冲结束后不会再来一次 playingChange。
          report(false);
        }
      }),
      player.addListener('playingChange', ({ isPlaying }) => {
        if (cancelled) return;
        if (isPlaying) {
          endedRef.current = false;
          setFirstFrameShown(true);
          report(true);
        } else if (player.status !== 'loading') {
          // 安卓缓冲时 isPlaying 也是 false：用户没暂停，翻页锁和原生控件都要留着。
          report(false);
        }
      }),
      player.addListener('playToEnd', () => {
        endedRef.current = true;
      }),
    ];
    void player.replaceAsync(cachedVideoSource(videoUrl, !ephemeral)).then(() => {
      if (!cancelled) player.play();
    }).catch(() => {
      if (!cancelled) {
        setFailed(true);
        setLoading(false);
        reportHandledFailure('mediaViewer', 'videoLoad', new Error('Video load failed'));
      }
    });
    return () => {
      cancelled = true;
      subscriptions.forEach((subscription) => subscription.remove());
      // 换源或重试时旧播放已结束；不复位的话新源加载失败，翻页和下滑会一直锁着。
      report(false);
    };
  }, [attempt, ephemeral, player, videoUrl]);

  const resume = () => {
    if (endedRef.current) {
      endedRef.current = false;
      player.replay();
    } else {
      player.play();
    }
  };
  const canResume = !loading && !failed;

  return (
    <>
      {/* 暂停时也不关 nativeControls：系统播放器拖进度条时可能短暂报告暂停，关控件会打断拖动。 */}
      <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" surfaceType="textureView" />
      {firstFrameShown ? null : poster}
      {/* 原生控件会吃掉所有触摸；没在播放时盖一层，横滑才轮得到外层列表、下滑才轮得到这一页。 */}
      {playing ? null : (
        <Pressable
          testID="viewer-video-gesture-layer"
          style={[s.gestureLayer, { bottom: NATIVE_CONTROL_BAR_HEIGHT + insets.bottom }]}
          onPress={canResume ? resume : undefined}
          accessibilityRole="button"
          accessibilityLabel={canResume ? t('chat.detail.playVideo') : undefined}
        />
      )}
      {loading ? (
        <View style={s.center} pointerEvents="none" accessible accessibilityRole="progressbar" accessibilityLabel={t('common.loading')}>
          <MediaProgressBar percent={null} />
        </View>
      ) : null}
      {failed ? (
        <View style={s.center}>
          <Text style={s.playbackText}>{t('chat.detail.videoUnavailable')}</Text>
          <Pressable style={s.retryButton} onPress={() => setAttempt((value) => value + 1)} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
            <Text style={s.playbackText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

interface ViewerVideoPageProps {
  videoUrl: string;
  posterUrl?: string;
  posterCacheKey?: string;
  /** 阅后即焚：视频流不进持久缓存，封面只进内存。 */
  ephemeral: boolean;
  width: number;
  height: number;
  /** 是否一进来就播放；只在挂载时读一次。 */
  autoPlay: boolean;
  /** 播放或下滑期间外层须暂停翻页。 */
  onPagerLockChange: (locked: boolean) => void;
  onSwipeDown: () => void;
}

/**
 * 全屏查看器里的视频页。没在播放时手势和图片页一致（横滑翻页、下滑关闭），
 * 播放时手势全部让给系统播放器。播放器按需创建，翻走即卸载（见 ImageViewer）。
 */
export function ViewerVideoPage({
  videoUrl,
  posterUrl,
  posterCacheKey,
  ephemeral,
  width,
  height,
  autoPlay,
  onPagerLockChange,
  onSwipeDown,
}: ViewerVideoPageProps) {
  const { t } = useTranslation();
  const translateY = useRef(new Animated.Value(0)).current;
  const [started, setStarted] = useState(autoPlay);
  const [posterLoading, setPosterLoading] = useState(false);
  // 手势回调要同步读这些值；responder 只建一次，重渲染不能清掉正在累计的 dx/dy。
  const lock = useRef({ playing: false, dragging: false });
  const callbacks = useRef({ onPagerLockChange, onSwipeDown });
  callbacks.current = { onPagerLockChange, onSwipeDown };

  const syncPagerLock = useCallback(() => {
    callbacks.current.onPagerLockChange(lock.current.playing || lock.current.dragging);
  }, []);

  const handlePlayingChange = useCallback((playing: boolean) => {
    lock.current.playing = playing;
    syncPagerLock();
  }, [syncPagerLock]);

  const panResponder = useMemo(() => {
    const endDrag = () => {
      lock.current.dragging = false;
      syncPagerLock();
    };
    const snapBack = () => {
      Animated.spring(translateY, { toValue: 0, useNativeDriver: false }).start();
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        !lock.current.playing &&
        gesture.dy > SWIPE_CLAIM_DISTANCE &&
        gesture.dy > Math.abs(gesture.dx) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        lock.current.dragging = true;
        syncPagerLock();
      },
      onPanResponderMove: (_event, gesture) => translateY.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        endDrag();
        if (gesture.dy >= SWIPE_DISMISS_DISTANCE || gesture.vy >= SWIPE_DISMISS_VELOCITY) {
          callbacks.current.onSwipeDown();
        } else {
          snapBack();
        }
      },
      onPanResponderTerminate: () => {
        endDrag();
        snapBack();
      },
    });
  }, [syncPagerLock, translateY]);

  const poster = posterUrl ? (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <MediaImage
        testID="viewer-video-poster"
        source={posterCacheKey ? { uri: posterUrl, cacheKey: posterCacheKey } : { uri: posterUrl }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        cachePolicy={ephemeral ? 'memory' : 'memory-disk'}
        onLoadStart={() => setPosterLoading(true)}
        onLoadEnd={() => setPosterLoading(false)}
      />
    </View>
  ) : null;

  return (
    <View style={[{ width, height }, s.page]} {...panResponder.panHandlers}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY }] }]}>
        {started ? (
          <ViewerVideoPlayer key={videoUrl} videoUrl={videoUrl} ephemeral={ephemeral} poster={poster} onPlayingChange={handlePlayingChange} />
        ) : (
          <>
            {poster}
            <Pressable style={s.center} onPress={() => setStarted(true)} accessibilityRole="button" accessibilityLabel={t('chat.detail.playVideo')}>
              {posterUrl && posterLoading ? null : (
                <View testID="viewer-video-play-badge" style={s.playBadge}>
                  <Ionicons name="play" size={32} color="#FFFFFF" />
                </View>
              )}
            </Pressable>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { overflow: 'hidden' },
  gestureLayer: { position: 'absolute', top: 0, left: 0, right: 0 },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  playBadge: {
    width: 64,
    height: 64,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  playbackText: { ...Typography.body, color: '#FFFFFF' },
  retryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.lg },
});
