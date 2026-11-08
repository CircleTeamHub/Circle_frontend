import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Animated, FlatList, PanResponder, StyleSheet } from 'react-native';
import { ImageViewer } from './image-viewer';
import { ViewerVideoPage } from './viewer-video-page';

// 手势跑在 PanResponder 上,和 zoomable-image.spec 一样把回调抓出来喂事件;
// 播放器是原生模块,只模拟它对外的事件和状态字段。
jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: (props: object) => <View {...props} /> };
});

type Listener = (payload: Record<string, unknown>) => void;
const mockListeners = new Map<string, Listener>();
const mockPlayer = {
  status: 'idle',
  playing: false,
  replaceAsync: jest.fn(() => Promise.resolve()),
  play: jest.fn(),
  replay: jest.fn(),
  addListener: jest.fn((name: string, listener: Listener) => {
    mockListeners.set(name, listener);
    return { remove: () => mockListeners.delete(name) };
  }),
};
const mockRelease = jest.fn();
jest.mock('expo-video', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useVideoPlayer: () => {
      useEffect(() => () => mockRelease(), []);
      return mockPlayer;
    },
    VideoView: () => <View testID="video-player" />,
  };
});
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/app/UploadProgressHost', () => ({ UploadProgressHost: () => null }));
jest.mock('@/utils/save-image', () => ({ saveImageToLibrary: jest.fn() }));
jest.mock('@/theme', () => ({
  Radius: { xl: 20, full: 9999 },
  Spacing: { sm: 4, md: 8, lg: 16 },
  Typography: { body: {} },
  useTheme: () => ({ colors: {} }),
}));

type Gesture = { dx: number; dy: number; vy: number };
type Handlers = {
  onMoveShouldSetPanResponder: (event: unknown, state: Gesture) => boolean;
  onPanResponderGrant: (event: unknown, state: Gesture) => void;
  onPanResponderMove: (event: unknown, state: Gesture) => void;
  onPanResponderRelease: (event: unknown, state: Gesture) => void;
  onPanResponderTerminate: (event: unknown, state: Gesture) => void;
  onPanResponderTerminationRequest: (event: unknown, state: Gesture) => boolean;
};
let captured: Handlers;
const createResponder = jest.spyOn(PanResponder, 'create').mockImplementation((config) => {
  captured = config as unknown as Handlers;
  return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
});

const drag = (dx: number, dy: number, vy = 0): Gesture => ({ dx, dy, vy });
const fire = (handler: 'onPanResponderGrant' | 'onPanResponderMove' | 'onPanResponderRelease' | 'onPanResponderTerminate', state: Gesture) => {
  act(() => captured[handler]({}, state));
};
const clipUrl = 'https://media.example.com/clip.mp4';
const PLAY_LABEL = 'chat.detail.playVideo';

function renderPage(props: Partial<React.ComponentProps<typeof ViewerVideoPage>> = {}) {
  const onPagerLockChange = jest.fn();
  const onSwipeDown = jest.fn();
  const element = (next: Partial<React.ComponentProps<typeof ViewerVideoPage>> = {}) => (
    <ViewerVideoPage
      videoUrl={clipUrl}
      posterUrl="https://media.example.com/poster.jpg"
      posterCacheKey="chat/poster.jpg"
      ephemeral={false}
      width={390}
      height={844}
      autoPlay={false}
      onPagerLockChange={onPagerLockChange}
      onSwipeDown={onSwipeDown}
      {...props}
      {...next}
    />
  );
  const view = render(element());
  return { ...view, element, onPagerLockChange, onSwipeDown };
}

function emitPlaying(isPlaying: boolean, status = 'readyToPlay') {
  mockPlayer.playing = isPlaying;
  mockPlayer.status = status;
  act(() => mockListeners.get('playingChange')?.({ isPlaying }));
}
function emitStatus(status: string) {
  mockPlayer.status = status;
  act(() => mockListeners.get('statusChange')?.({ status }));
}
async function renderPlayingPage(props: Partial<React.ComponentProps<typeof ViewerVideoPage>> = {}) {
  const page = renderPage({ autoPlay: true, ...props });
  await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
  emitStatus('readyToPlay');
  emitPlaying(true);
  return page;
}

beforeEach(() => {
  mockListeners.clear();
  mockPlayer.status = 'idle';
  mockPlayer.playing = false;
  mockPlayer.replaceAsync.mockReset().mockResolvedValue(undefined);
  mockPlayer.play.mockClear();
  mockPlayer.replay.mockClear();
  mockRelease.mockClear();
});

describe('before playback', () => {
  test('a page reached by swiping shows its poster and creates no player', () => {
    renderPage();
    expect(screen.getByTestId('viewer-video-poster').props.source).toEqual({
      uri: 'https://media.example.com/poster.jpg',
      cacheKey: 'chat/poster.jpg',
    });
    expect(screen.queryByTestId('video-player')).toBeNull();
    expect(mockPlayer.replaceAsync).not.toHaveBeenCalled();
  });

  test('tapping the page loads and plays the video', async () => {
    renderPage();
    fireEvent.press(screen.getByLabelText(PLAY_LABEL));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    expect(mockPlayer.replaceAsync).toHaveBeenCalledWith(expect.objectContaining({ uri: clipUrl, useCaching: true }));
  });

  test('the video the user tapped in the conversation starts immediately', async () => {
    renderPage({ autoPlay: true });
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
  });

  test('a disappearing video keeps its bytes and poster off the disk', async () => {
    renderPage({ autoPlay: true, ephemeral: true });
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    expect(mockPlayer.replaceAsync).toHaveBeenCalledWith({ uri: clipUrl, useCaching: false });
    expect(screen.getByTestId('viewer-video-poster').props.cachePolicy).toBe('memory');
  });

  test('the poster stays up until the first frame instead of flashing black', async () => {
    renderPage({ autoPlay: true });
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('viewer-video-poster')).toBeTruthy();
    emitPlaying(true);
    expect(screen.queryByTestId('viewer-video-poster')).toBeNull();
  });

  test('a slow poster shows its download progress instead of the play badge', () => {
    renderPage();
    expect(screen.getByTestId('viewer-video-play-badge')).toBeTruthy();
    fireEvent(screen.getByTestId('viewer-video-poster'), 'loadStart');
    expect(screen.queryByTestId('viewer-video-play-badge')).toBeNull();
    fireEvent(screen.getByTestId('viewer-video-poster'), 'loadEnd');
    expect(screen.getByTestId('viewer-video-play-badge')).toBeTruthy();
  });

  test('older videos without a poster still offer play', () => {
    renderPage({ posterUrl: undefined, posterCacheKey: undefined });
    expect(screen.queryByTestId('viewer-video-poster')).toBeNull();
    expect(screen.getByLabelText(PLAY_LABEL)).toBeTruthy();
  });
});

describe('pager lock follows playback', () => {
  test('playing blocks page swipes and pausing releases them', async () => {
    const { onPagerLockChange } = await renderPlayingPage();
    expect(onPagerLockChange).toHaveBeenLastCalledWith(true);
    emitPlaying(false);
    expect(onPagerLockChange).toHaveBeenLastCalledWith(false);
  });

  test('rebuffering is not a pause: the pager stays locked and native controls stay reachable', async () => {
    const { onPagerLockChange } = await renderPlayingPage();
    emitStatus('loading');
    emitPlaying(false, 'loading');
    expect(onPagerLockChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByLabelText(PLAY_LABEL)).toBeNull();
  });

  test('pausing during a rebuffer releases the pager once buffering ends', async () => {
    const { onPagerLockChange } = await renderPlayingPage();
    emitStatus('loading');
    emitPlaying(false, 'loading');
    emitStatus('readyToPlay');
    expect(onPagerLockChange).toHaveBeenLastCalledWith(false);
  });

  test('a playback error releases the pager and offers retry', async () => {
    const { onPagerLockChange } = await renderPlayingPage();
    emitPlaying(false, 'error');
    emitStatus('error');
    expect(onPagerLockChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText('common.retry')).toBeTruthy();
  });
});

describe('resuming', () => {
  test('tapping a paused video continues from where it stopped', async () => {
    await renderPlayingPage();
    emitPlaying(false);
    mockPlayer.play.mockClear();
    fireEvent.press(screen.getByLabelText(PLAY_LABEL));
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.replay).not.toHaveBeenCalled();
  });

  test('tapping after the video ended restarts it', async () => {
    await renderPlayingPage();
    act(() => mockListeners.get('playToEnd')?.({}));
    emitStatus('idle');
    emitPlaying(false, 'idle');
    mockPlayer.play.mockClear();
    fireEvent.press(screen.getByLabelText(PLAY_LABEL));
    expect(mockPlayer.replay).toHaveBeenCalledTimes(1);
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });

  test('the idle status after the video ended does not show a loading bar', async () => {
    await renderPlayingPage();
    act(() => mockListeners.get('playToEnd')?.({}));
    emitStatus('idle');
    emitPlaying(false, 'idle');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  test('the paused gesture layer leaves the native progress bar uncovered', async () => {
    await renderPlayingPage();
    emitPlaying(false);
    const layer = StyleSheet.flatten(screen.getByLabelText(PLAY_LABEL).props.style);
    expect(layer.bottom).toBeGreaterThan(34);
  });
});

describe('swipe down to dismiss', () => {
  const spring = jest.spyOn(Animated, 'spring');
  beforeEach(() => spring.mockClear());

  test('claims a downward drag on an idle page but leaves horizontal drags to the pager', () => {
    renderPage();
    expect(captured.onMoveShouldSetPanResponder({}, drag(0, 40))).toBe(true);
    expect(captured.onMoveShouldSetPanResponder({}, drag(60, 20))).toBe(false);
    expect(captured.onMoveShouldSetPanResponder({}, drag(0, -40))).toBe(false);
  });

  test('a playing video keeps the drag for its native controls', async () => {
    await renderPlayingPage();
    expect(captured.onMoveShouldSetPanResponder({}, drag(0, 40))).toBe(false);
  });

  test('a paused video can be swiped down again', async () => {
    await renderPlayingPage();
    emitPlaying(false);
    expect(captured.onMoveShouldSetPanResponder({}, drag(0, 40))).toBe(true);
  });

  test('the page follows the finger and locks paging for the whole drag', () => {
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    const { onPagerLockChange } = renderPage();
    fire('onPanResponderGrant', drag(0, 0));
    expect(onPagerLockChange).toHaveBeenLastCalledWith(true);
    fire('onPanResponderMove', drag(0, 60));
    expect(setValue).toHaveBeenLastCalledWith(60);
    fire('onPanResponderMove', drag(0, -30));
    expect(setValue).toHaveBeenLastCalledWith(0);
    setValue.mockRestore();
  });

  test.each([
    ['distance', drag(0, 120, 0.1)],
    ['velocity', drag(0, 40, 1.4)],
  ])('dismisses past the %s threshold and unlocks paging', (_name, release) => {
    const { onSwipeDown, onPagerLockChange } = renderPage();
    fire('onPanResponderGrant', drag(0, 0));
    fire('onPanResponderRelease', release);
    expect(onSwipeDown).toHaveBeenCalledTimes(1);
    expect(onPagerLockChange).toHaveBeenLastCalledWith(false);
  });

  test('a short drag snaps back without dismissing', () => {
    const { onSwipeDown, onPagerLockChange } = renderPage();
    fire('onPanResponderGrant', drag(0, 0));
    fire('onPanResponderRelease', drag(0, 50, 0.1));
    expect(onSwipeDown).not.toHaveBeenCalled();
    expect(spring).toHaveBeenCalledTimes(1);
    expect(onPagerLockChange).toHaveBeenLastCalledWith(false);
  });

  test('an interrupted drag snaps back and unlocks paging', () => {
    const { onSwipeDown, onPagerLockChange } = renderPage();
    fire('onPanResponderGrant', drag(0, 0));
    fire('onPanResponderTerminate', drag(0, 200, 2));
    expect(onSwipeDown).not.toHaveBeenCalled();
    expect(spring).toHaveBeenCalledTimes(1);
    expect(onPagerLockChange).toHaveBeenLastCalledWith(false);
  });

  test('video starting mid-drag keeps the pager locked after the finger lifts', async () => {
    const { onPagerLockChange } = renderPage({ autoPlay: true });
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    fire('onPanResponderGrant', drag(0, 0));
    emitPlaying(true);
    fire('onPanResponderRelease', drag(0, 30, 0.1));
    expect(onPagerLockChange).toHaveBeenLastCalledWith(true);
  });

  test('re-renders keep the same responder so an in-progress drag is not reset', () => {
    const { rerender, element, onPagerLockChange } = renderPage();
    const created = createResponder.mock.calls.length;
    fire('onPanResponderGrant', drag(0, 0));
    rerender(element({ onPagerLockChange: jest.fn() }));
    expect(createResponder.mock.calls.length).toBe(created);
    expect(onPagerLockChange).toHaveBeenCalledTimes(1);
  });

  test('the latest callbacks are used after a re-render', () => {
    const { rerender, element, onSwipeDown } = renderPage();
    const latest = jest.fn();
    rerender(element({ onSwipeDown: latest }));
    fire('onPanResponderGrant', drag(0, 0));
    fire('onPanResponderRelease', drag(0, 200, 0.1));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(onSwipeDown).not.toHaveBeenCalled();
  });
});

describe('loading and failure', () => {
  test('shows the loading bar until ready and again while rebuffering', async () => {
    let resolve!: () => void;
    mockPlayer.replaceAsync.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    renderPage({ autoPlay: true });
    expect(screen.getByRole('progressbar')).toBeTruthy();
    await act(async () => resolve());
    emitStatus('readyToPlay');
    expect(screen.queryByRole('progressbar')).toBeNull();
    emitStatus('loading');
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  test('a failed load offers retry and keeps swipes available', async () => {
    mockPlayer.replaceAsync.mockRejectedValueOnce(new Error('network'));
    const { onPagerLockChange } = renderPage({ autoPlay: true });
    await waitFor(() => expect(screen.getByLabelText('common.retry')).toBeTruthy());
    expect(mockPlayer.play).not.toHaveBeenCalled();
    expect(captured.onMoveShouldSetPanResponder({}, drag(0, 40))).toBe(true);
    expect(onPagerLockChange).not.toHaveBeenCalledWith(true);
    fireEvent.press(screen.getByLabelText('common.retry'));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
  });

  test('tapping a page that is still loading does not start playback early', () => {
    mockPlayer.replaceAsync.mockImplementationOnce(() => new Promise<void>(() => undefined));
    renderPage({ autoPlay: true });
    fireEvent.press(screen.getByTestId('viewer-video-gesture-layer'));
    expect(mockPlayer.play).not.toHaveBeenCalled();
  });
});

describe('player lifetime', () => {
  test('leaving the page during loading never starts playback and releases the player', async () => {
    let resolve!: () => void;
    mockPlayer.replaceAsync.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    const { unmount } = renderPage({ autoPlay: true });
    unmount();
    await act(async () => resolve());
    expect(mockPlayer.play).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('a replacement player that fails to load does not leave the pager locked', async () => {
    const { rerender, element, onPagerLockChange } = await renderPlayingPage();
    expect(onPagerLockChange).toHaveBeenLastCalledWith(true);
    mockPlayer.replaceAsync.mockRejectedValueOnce(new Error('expired'));
    rerender(element({ videoUrl: `${clipUrl}?fresh` }));
    await waitFor(() => expect(screen.getByLabelText('common.retry')).toBeTruthy());
    expect(onPagerLockChange).toHaveBeenLastCalledWith(false);
    expect(captured.onMoveShouldSetPanResponder({}, drag(0, 40))).toBe(true);
  });

  test('a refreshed signed URL replaces the source of the running player', async () => {
    const { rerender, element } = renderPage({ autoPlay: true });
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    rerender(element({ videoUrl: `${clipUrl}?fresh` }));
    await waitFor(() => expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ uri: `${clipUrl}?fresh` })));
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

describe('inside the real viewer', () => {
  const viewer = (onClose = jest.fn()) => (
    <ImageViewer images={['poster.jpg', 'photo.jpg']} videos={[clipUrl, undefined]} autoPlayInitialVideo visible onClose={onClose} />
  );

  test('page swipes are blocked only while the video plays', async () => {
    render(viewer());
    const list = screen.UNSAFE_getByType(FlatList);
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    expect(list.props.scrollEnabled).toBe(true);
    emitStatus('readyToPlay');
    emitPlaying(true);
    expect(list.props.scrollEnabled).toBe(false);
    emitPlaying(false);
    expect(list.props.scrollEnabled).toBe(true);
  });

  test('swiping a paused video away releases its player', async () => {
    render(viewer());
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    emitStatus('readyToPlay');
    emitPlaying(false);
    fireEvent.scroll(screen.UNSAFE_getByType(FlatList), { nativeEvent: { contentOffset: { x: 750, y: 0 } } });
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('video-player')).toBeNull();
  });

  test('swiping a paused video down closes the viewer', async () => {
    const onClose = jest.fn();
    render(viewer(onClose));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    emitStatus('readyToPlay');
    emitPlaying(false);
    expect(captured.onMoveShouldSetPanResponder({}, drag(0, 40))).toBe(true);
    fire('onPanResponderGrant', drag(0, 0));
    fire('onPanResponderRelease', drag(0, 200, 0.1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
