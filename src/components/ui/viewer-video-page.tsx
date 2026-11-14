import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
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

const SKIP_SECONDS = 15;
/** 倍速按钮依次切换的档位；回到 1 倍是一圈。 */
const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.5] as const;
const TIME_UPDATE_INTERVAL_SECONDS = 0.25;
const THUMB_SIZE = 14;
const SCRUBBER_HEIGHT = 32;

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

interface ScrubberProps {
  progress: number;
  label: string;
  onScrubStart: () => void;
  onScrub: (ratio: number) => void;
  onScrubEnd: (ratio: number | null) => void;
  onStep: (direction: 1 | -1) => void;
}

/**
 * 进度条。直接用 View 的 responder：按下就接管、拒绝让出，拖动时外层翻页和下滑都抢不走。
 * 轨道和圆点不接触摸，触点永远落在轨道容器上，locationX 才是相对整条轨道的。
 */
function Scrubber({ progress, label, onScrubStart, onScrub, onScrubEnd, onStep }: ScrubberProps) {
  const [width, setWidth] = useState(0);
  const drag = useRef<{ startRatio: number; startPageX: number } | null>(null);
  const ratioAt = (event: GestureResponderEvent) => {
    const start = drag.current;
    return start && width > 0
      ? clamp01(start.startRatio + (event.nativeEvent.pageX - start.startPageX) / width)
      : progress;
  };
  const percent = `${clamp01(progress) * 100}%` as const;
  return (
    <View
      testID="viewer-video-scrubber"
      style={s.scrubber}
      hitSlop={{ top: 14, bottom: 14 }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        const startRatio = width > 0 ? clamp01(event.nativeEvent.locationX / width) : clamp01(progress);
        drag.current = { startRatio, startPageX: event.nativeEvent.pageX };
        onScrubStart();
        onScrub(startRatio);
        // 安卓上返回 true 才能挡住外层原生 ScrollView 接管这次横滑。
        return true;
      }}
      onResponderMove={(event) => onScrub(ratioAt(event))}
      onResponderRelease={(event) => {
        const ratio = ratioAt(event);
        drag.current = null;
        onScrubEnd(ratio);
      }}
      onResponderTerminate={() => {
        drag.current = null;
        onScrubEnd(null);
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamp01(progress) * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={({ nativeEvent }) => onStep(nativeEvent.actionName === 'increment' ? 1 : -1)}
    >
      <View style={s.track} pointerEvents="none">
        <View style={[s.trackFill, { width: percent }]} />
      </View>
      <View style={[s.thumb, { left: percent, marginLeft: -THUMB_SIZE / 2 }]} pointerEvents="none" />
    </View>
  );
}

interface VideoControlBarProps {
  player: VideoPlayer;
  playing: boolean;
  canResume: boolean;
  onTogglePlay: () => void;
  onScrubbingChange: (scrubbing: boolean) => void;
}

/** 底部控件条：后退 15 秒、播放/暂停、前进 15 秒、已播时长、进度条、剩余时长、倍速。 */
function VideoControlBar({ player, playing, canResume, onTogglePlay, onScrubbingChange }: VideoControlBarProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [time, setTime] = useState({ current: player.currentTime ?? 0, duration: player.duration ?? 0 });
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    // 时间只在控件条里订阅：每 0.25 秒一次的刷新不该带着整页重渲染。
    player.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_SECONDS;
    const subscriptions = [
      player.addListener('timeUpdate', ({ currentTime }) => {
        setTime({ current: currentTime, duration: player.duration });
      }),
      player.addListener('sourceLoad', ({ duration }) => {
        setTime((previous) => ({ ...previous, duration }));
      }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [player]);

  const duration = time.duration > 0 ? time.duration : 0;
  const shownTime = scrubRatio !== null ? scrubRatio * duration : Math.min(time.current, duration || time.current);
  const seekTo = (seconds: number) => {
    const target = Math.min(Math.max(0, seconds), duration || seconds);
    player.currentTime = target;
    // 下一次 timeUpdate 之前先挪过去，松手时圆点不会弹回旧位置。
    setTime((previous) => ({ ...previous, current: target }));
  };
  const skip = (direction: 1 | -1) => seekTo(time.current + direction * SKIP_SECONDS);
  const cycleRate = () => {
    const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]) + 1) % PLAYBACK_RATES.length];
    player.playbackRate = next;
    setRate(next);
  };

  return (
    <View testID="viewer-video-controls" style={[s.controlBar, { bottom: insets.bottom + Spacing.md }]}>
      <Pressable style={s.controlButton} hitSlop={6} onPress={() => skip(-1)} accessibilityRole="button" accessibilityLabel={t('chat.detail.videoSkipBack')}>
        <MaterialCommunityIcons name="rewind-15" size={22} color="#FFFFFF" />
      </Pressable>
      <Pressable
        style={s.controlButton}
        hitSlop={6}
        onPress={onTogglePlay}
        disabled={!playing && !canResume}
        accessibilityRole="button"
        accessibilityLabel={t(playing ? 'chat.detail.pauseVideo' : 'chat.detail.playVideo')}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={22} color="#FFFFFF" />
      </Pressable>
      <Pressable style={s.controlButton} hitSlop={6} onPress={() => skip(1)} accessibilityRole="button" accessibilityLabel={t('chat.detail.videoSkipForward')}>
        <MaterialCommunityIcons name="fast-forward-15" size={22} color="#FFFFFF" />
      </Pressable>
      <Text style={s.clock}>{formatClock(shownTime)}</Text>
      <Scrubber
        progress={duration > 0 ? shownTime / duration : 0}
        label={t('chat.detail.videoSeek')}
        onScrubStart={() => onScrubbingChange(true)}
        onScrub={setScrubRatio}
        onScrubEnd={(ratio) => {
          if (ratio !== null && duration > 0) seekTo(ratio * duration);
          setScrubRatio(null);
          onScrubbingChange(false);
        }}
        onStep={skip}
      />
      {/* 已播取整秒、剩余用总时长减它：两边加起来恒等于总时长（开头 00:00 / -00:14）。 */}
      <Text style={s.clock}>{`-${formatClock(Math.round(duration) - Math.floor(shownTime))}`}</Text>
      <Pressable
        style={s.controlButton}
        hitSlop={6}
        onPress={cycleRate}
        accessibilityRole="button"
        accessibilityLabel={t('chat.detail.videoPlaybackSpeed', { rate })}
      >
        {rate === 1 ? (
          <Ionicons name="speedometer-outline" size={20} color="#FFFFFF" />
        ) : (
          <Text style={s.rateText}>{`${rate}x`}</Text>
        )}
      </Pressable>
    </View>
  );
}

interface ViewerVideoPlayerProps {
  videoUrl: string;
  ephemeral: boolean;
  poster: ReactNode;
  onPlayingChange: (playing: boolean) => void;
  onScrubbingChange: (scrubbing: boolean) => void;
  onMediaError?: () => void;
}

/** 只在这一页开始播放后挂载；useVideoPlayer 卸载时释放解码器。 */
function ViewerVideoPlayer({ videoUrl, ephemeral, poster, onPlayingChange, onScrubbingChange, onMediaError }: ViewerVideoPlayerProps) {
  const { t } = useTranslation();
  const player = useVideoPlayer(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [firstFrameShown, setFirstFrameShown] = useState(false);
  const endedRef = useRef(false);
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;
  const onMediaErrorRef = useRef(onMediaError);
  onMediaErrorRef.current = onMediaError;

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
          onMediaErrorRef.current?.();
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
        onMediaErrorRef.current?.();
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
  const togglePlay = () => {
    if (playing) player.pause();
    else if (canResume) resume();
  };

  return (
    <>
      {/* 不用系统控件：它的布局由系统决定（iOS 全屏尺寸时把按钮摆在画面正中），也会吃掉所有触摸。 */}
      <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" surfaceType="textureView" />
      {firstFrameShown ? null : poster}
      {/* 点画面切换播放/暂停；读屏走控件条上的同名按钮，这层不重复播报。 */}
      <Pressable
        testID="viewer-video-gesture-layer"
        style={StyleSheet.absoluteFill}
        onPress={togglePlay}
        accessible={false}
      />
      {failed ? null : (
        <VideoControlBar
          player={player}
          playing={playing}
          canResume={canResume}
          onTogglePlay={togglePlay}
          onScrubbingChange={onScrubbingChange}
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
  /** 加载或播放失败;笔记据此重新签发过期的媒体地址。 */
  onMediaError?: () => void;
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
  onMediaError,
}: ViewerVideoPageProps) {
  const { t } = useTranslation();
  const translateY = useRef(new Animated.Value(0)).current;
  const [started, setStarted] = useState(autoPlay);
  // 手势回调要同步读这些值；responder 只建一次，重渲染不能清掉正在累计的 dx/dy。
  const lock = useRef({ playing: false, dragging: false, scrubbing: false });
  const callbacks = useRef({ onPagerLockChange, onSwipeDown });
  callbacks.current = { onPagerLockChange, onSwipeDown };

  const syncPagerLock = useCallback(() => {
    const { playing, dragging, scrubbing } = lock.current;
    callbacks.current.onPagerLockChange(playing || dragging || scrubbing);
  }, []);

  const handlePlayingChange = useCallback((playing: boolean) => {
    lock.current.playing = playing;
    syncPagerLock();
  }, [syncPagerLock]);

  // 暂停时拖进度条也是横滑：拖动期间锁住翻页，否则外层列表会把这一页翻走。
  const handleScrubbingChange = useCallback((scrubbing: boolean) => {
    lock.current.scrubbing = scrubbing;
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
        !lock.current.scrubbing &&
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

  const playBadge = (
    <View testID="viewer-video-play-badge" style={s.playBadge}>
      <Ionicons name="play" size={32} color="#FFFFFF" />
    </View>
  );
  // 开播前的播放键交给 MediaImage 画在封面上:封面真在下载、显示进度时让位给进度,显示后回来。
  // 原来这里自己记「封面加载中」,缓存命中的封面也要让播放键闪一下、整页多渲染两遍。
  const renderPoster = (overlay?: ReactNode) => posterUrl ? (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <MediaImage
        testID="viewer-video-poster"
        source={posterCacheKey ? { uri: posterUrl, cacheKey: posterCacheKey } : { uri: posterUrl }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        cachePolicy={ephemeral ? 'memory' : 'memory-disk'}
        overlay={overlay}
      />
    </View>
  ) : null;

  return (
    <View style={[{ width, height }, s.page]} {...panResponder.panHandlers}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY }] }]}>
        {started ? (
          <ViewerVideoPlayer
            key={videoUrl}
            videoUrl={videoUrl}
            ephemeral={ephemeral}
            poster={renderPoster()}
            onPlayingChange={handlePlayingChange}
            onScrubbingChange={handleScrubbingChange}
            onMediaError={onMediaError}
          />
        ) : (
          <>
            {renderPoster(<View style={s.center} pointerEvents="none">{playBadge}</View>)}
            <Pressable style={s.center} onPress={() => setStarted(true)} accessibilityRole="button" accessibilityLabel={t('chat.detail.playVideo')}>
              {posterUrl ? null : playBadge}
            </Pressable>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { overflow: 'hidden' },
  // 深色半透明圆角条，贴底悬浮在画面上（参照系统播放器的内嵌控件条）。
  controlBar: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(28,28,30,0.82)',
  },
  controlButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  clock: {
    ...Typography.tinyRegular,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  rateText: { ...Typography.tinyRegular, color: '#FFFFFF', fontWeight: '600' },
  scrubber: { flex: 1, height: SCRUBBER_HEIGHT, justifyContent: 'center', marginHorizontal: Spacing.xs },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.3)' },
  trackFill: { height: 4, backgroundColor: 'rgba(255,255,255,0.85)' },
  thumb: {
    position: 'absolute',
    top: (SCRUBBER_HEIGHT - THUMB_SIZE) / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#FFFFFF',
  },
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
