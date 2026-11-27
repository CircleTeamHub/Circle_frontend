import { Platform } from 'react-native';
import { createVideoPlayer } from 'expo-video';
import { ImageManipulator } from 'expo-image-manipulator';
import {
  requestUploadPresign,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { reportHandledFailure } from '@/observability/report-failure';
import { captureVideoPosterFrame, uploadChatVideoPoster } from './chat-video-poster';

jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

jest.mock('expo-video', () => ({ createVideoPlayer: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  sanitizeUploadFilename: jest.fn((value: string) => value),
  uploadLocalFileToPresignedUrl: jest.fn(),
}));

const mockCreateVideoPlayer = createVideoPlayer as jest.Mock;
const mockManipulate = ImageManipulator.manipulate as jest.Mock;
const mockPresign = requestUploadPresign as jest.Mock;
const mockUpload = uploadLocalFileToPresignedUrl as jest.Mock;

type MockStatusPayload = { status: string; error?: { message: string } };
type MockStatusListener = (payload: MockStatusPayload) => void;

/**
 * 照 iOS 的行为：replaceAsync 先返回，视频过几个微任务才挂到播放器上并发出 readyToPlay
 * （expo-video 的 replaceCurrentItem 用 DispatchQueue.main.async 挂 currentItem）；
 * 挂上之前截帧只会得到空数组，时长也还是 0。
 */
function mockPlayer(frames: unknown[] | Error, { duration = 0 } = {}) {
  let loaded = false;
  const listeners = new Set<MockStatusListener>();
  const emit = (payload: MockStatusPayload) => {
    player.status = payload.status;
    listeners.forEach((listener) => listener(payload));
  };
  const attach = () => {
    loaded = true;
    player.duration = duration;
    emit({ status: 'readyToPlay' });
  };
  const player = {
    status: 'idle',
    duration: 0,
    emit,
    attach,
    addListener: jest.fn((_event: string, listener: MockStatusListener) => {
      listeners.add(listener);
      return { remove: () => { listeners.delete(listener); } };
    }),
    listenerCount: () => listeners.size,
    replaceAsync: jest.fn((_uri: string): Promise<void> => {
      void Promise.resolve().then(() => undefined).then(() => undefined).then(attach);
      return Promise.resolve();
    }),
    generateThumbnailsAsync: jest.fn(() => {
      if (!loaded) return Promise.resolve([]);
      return frames instanceof Error ? Promise.reject(frames) : Promise.resolve(frames);
    }),
    release: jest.fn(),
  };
  mockCreateVideoPlayer.mockReturnValue(player);
  return player;
}

describe('uploadChatVideoPoster', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const saveAsync = jest.fn(() =>
      Promise.resolve({ uri: 'file:///cache/poster.jpg', width: 512, height: 288 }),
    );
    mockManipulate.mockReturnValue({
      renderAsync: jest.fn(() => Promise.resolve({ saveAsync })),
    });
    mockPresign.mockResolvedValue({
      uploadUrl: 'https://upload.test/poster',
      key: 'chat/me/poster.jpg',
      requiredHeaders: { 'If-None-Match': '*' },
    });
    mockUpload.mockResolvedValue(undefined);
  });

  it('grabs a frame half a second in, uploads it as a small JPEG and returns its key', async () => {
    const frame = { width: 512, height: 288 };
    const player = mockPlayer([frame]);

    await expect(
      uploadChatVideoPoster('file:///picked/trip.mov', 42, 'trip.mov', 'chat', undefined, 'video-delivery'),
    ).resolves.toEqual({ key: 'chat/me/poster.jpg' });

    expect(mockCreateVideoPlayer).toHaveBeenCalledWith(null);
    expect(player.replaceAsync).toHaveBeenCalledWith('file:///picked/trip.mov');
    // 很多视频第一帧是黑的(淡入、相机刚启动)。
    expect(player.generateThumbnailsAsync).toHaveBeenCalledWith(0.5, { maxWidth: 512 });
    expect(mockManipulate).toHaveBeenCalledWith(frame);
    expect(mockPresign).toHaveBeenCalledWith({
      filename: 'poster-trip.jpg',
      contentType: 'image/jpeg',
      folder: 'chat',
      fileUri: 'file:///cache/poster.jpg',
    });
    expect(mockUpload).toHaveBeenCalledWith(
      'https://upload.test/poster',
      'image/jpeg',
      'file:///cache/poster.jpg',
      { 'If-None-Match': '*' },
      undefined,
      { progressKey: 'video-delivery' },
    );
    // 播放器不跟组件走,用完必须手动释放,否则原生解码器一直占着。
    expect(player.release).toHaveBeenCalled();
  });

  it('waits for the video to load before grabbing a frame', async () => {
    // iOS attaches the item on the main queue after replaceAsync resolves; asking for frames
    // earlier returns [] and the video goes out with no poster (a black bubble).
    const player = mockPlayer([{ width: 512, height: 288 }]);
    player.replaceAsync.mockImplementationOnce(() => Promise.resolve());
    const uploading = uploadChatVideoPoster('file:///picked/trip.mov', 42, 'trip.mov');
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(player.generateThumbnailsAsync).not.toHaveBeenCalled();
    player.attach();
    await expect(uploading).resolves.toEqual({ key: 'chat/me/poster.jpg' });
    expect(player.generateThumbnailsAsync).toHaveBeenCalledTimes(1);
    expect(player.listenerCount()).toBe(0);
  });

  it('grabs the frame right away when the video is already attached as replaceAsync returns', async () => {
    // Android（和偶尔够快的 iOS）在 replaceAsync 回来之前就已经 readyToPlay，不会再发一次事件。
    const player = mockPlayer([{ width: 512, height: 288 }]);
    player.replaceAsync.mockImplementationOnce(() => {
      player.attach();
      return Promise.resolve();
    });
    await expect(uploadChatVideoPoster('file:///picked/trip.mov', 42, 'trip.mov')).resolves.toEqual({
      key: 'chat/me/poster.jpg',
    });
    expect(player.listenerCount()).toBe(0);
  });

  it('uses the loaded duration when the caller does not know it', async () => {
    const player = mockPlayer([{ width: 512, height: 288 }], { duration: 30 });
    await expect(captureVideoPosterFrame('https://media.example/v.mp4', undefined)).resolves.toEqual({
      uri: 'file:///cache/poster.jpg',
    });
    expect(player.generateThumbnailsAsync).toHaveBeenCalledWith(0.5, { maxWidth: 512 });
  });

  it('gives up and reports when the video fails to load', async () => {
    const player = mockPlayer([{ width: 512, height: 288 }]);
    player.replaceAsync.mockImplementationOnce(() => {
      void Promise.resolve().then(() => player.emit({ status: 'error', error: { message: 'cannot open' } }));
      return Promise.resolve();
    });
    await expect(uploadChatVideoPoster('file:///picked/odd.mkv', 10, 'odd.mkv')).resolves.toBeNull();
    expect(player.generateThumbnailsAsync).not.toHaveBeenCalled();
    expect(player.release).toHaveBeenCalled();
    expect(reportHandledFailure).toHaveBeenCalledWith(
      'chatVideoPoster',
      'captureFrame',
      expect.objectContaining({ message: 'cannot open' }),
    );
  });

  it('does not hold up the send when the video never finishes loading', async () => {
    jest.useFakeTimers();
    try {
      const player = mockPlayer([{ width: 512, height: 288 }]);
      player.replaceAsync.mockImplementationOnce(() => Promise.resolve());
      const uploading = uploadChatVideoPoster('file:///picked/stuck.mov', 42, 'stuck.mov');
      await jest.advanceTimersByTimeAsync(10_000);
      await expect(uploading).resolves.toBeNull();
      expect(player.generateThumbnailsAsync).not.toHaveBeenCalled();
      expect(player.release).toHaveBeenCalled();
      expect(player.listenerCount()).toBe(0);
      expect(mockPresign).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves the released player alone when the load finishes after the timeout', async () => {
    // 慢网下补截老消息的封面：超时后播放器已经释放，replaceAsync 才回来。这时再读 status，
    // iOS 会抛 NativeSharedObjectNotFoundException，成了一条没人接的 rejection。
    jest.useFakeTimers();
    try {
      const player = mockPlayer([{ width: 512, height: 288 }]);
      let finishLoading!: () => void;
      player.replaceAsync.mockImplementationOnce(
        () => new Promise<void>((resolve) => { finishLoading = resolve; }),
      );
      let released = false;
      let statusReadsAfterRelease = 0;
      player.release.mockImplementation(() => { released = true; });
      Object.defineProperty(player, 'status', {
        get: () => {
          if (released) statusReadsAfterRelease += 1;
          return 'idle';
        },
      });
      const capturing = captureVideoPosterFrame('https://media.example/old.mp4', undefined);
      await jest.advanceTimersByTimeAsync(10_000);
      await expect(capturing).resolves.toBeNull();
      expect(released).toBe(true);

      finishLoading();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      expect(statusReadsAfterRelease).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('tags a posts poster only when its caller supplies a moment purpose', async () => {
    mockPlayer([{ width: 512, height: 288 }]);

    await uploadChatVideoPoster(
      'file:///picked/trip.mov',
      42,
      'trip.mov',
      'posts',
      undefined,
      'moment-video',
      'MOMENT',
    );

    expect(mockPresign).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'posts', purpose: 'MOMENT' }),
    );
  });

  it('uses the very first frame of a clip shorter than a second', async () => {
    const player = mockPlayer([{ width: 512, height: 288 }]);
    await uploadChatVideoPoster('file:///picked/blink.mp4', 1, 'blink.mp4');
    expect(player.generateThumbnailsAsync).toHaveBeenCalledWith(0, { maxWidth: 512 });
  });

  it('gives up without failing the send (and still releases the player) when no frame can be read', async () => {
    const failure = new Error('unsupported codec');
    const player = mockPlayer(failure);
    await expect(
      uploadChatVideoPoster('file:///picked/odd.mkv', 10, 'odd.mkv'),
    ).resolves.toBeNull();
    expect(mockPresign).not.toHaveBeenCalled();
    expect(player.release).toHaveBeenCalled();
    // 没封面的气泡是一块黑:失败要上报,不然线上看不出是哪个平台、哪一步坏了。
    expect(reportHandledFailure).toHaveBeenCalledWith('chatVideoPoster', 'captureFrame', failure);
  });

  it('gives up quietly when the poster upload fails', async () => {
    mockPlayer([{ width: 512, height: 288 }]);
    mockUpload.mockRejectedValue(new Error('network down'));
    await expect(
      uploadChatVideoPoster('file:///picked/trip.mov', 42, 'trip.mov'),
    ).resolves.toBeNull();
  });

  it('checks the session after deferred presign and skips upload when the guard throws', async () => {
    mockPlayer([{ width: 512, height: 288 }]);
    let resolvePresign!: (value: object) => void;
    let markPresignStarted!: () => void;
    const presignStarted = new Promise<void>((resolve) => { markPresignStarted = resolve; });
    const presignWait = new Promise<object>((resolve) => { resolvePresign = resolve; });
    mockPresign.mockImplementationOnce(() => {
      markPresignStarted();
      return presignWait;
    });
    const beforeUpload = jest.fn(() => { throw new Error('session changed'); });
    const uploading = uploadChatVideoPoster('file:///video.mp4', 42, 'video.mp4', 'chat', beforeUpload);
    await presignStarted;
    expect(beforeUpload).not.toHaveBeenCalled();
    resolvePresign({ uploadUrl: 'https://upload.test/poster', key: 'chat/poster.jpg', requiredHeaders: {} });
    await expect(uploading).resolves.toBeNull();
    expect(beforeUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('captureVideoPosterFrame on web', () => {
  it('skips the capture without reporting, since expo-video cannot grab frames on web', async () => {
    jest.clearAllMocks();
    const restore = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      await expect(captureVideoPosterFrame('https://media.example/v.mp4', 3)).resolves.toBeNull();
    } finally {
      restore.restore();
    }
    expect(mockCreateVideoPlayer).not.toHaveBeenCalled();
    expect(reportHandledFailure).not.toHaveBeenCalled();
  });
});
