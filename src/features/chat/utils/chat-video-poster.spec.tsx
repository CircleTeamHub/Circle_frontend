import { createVideoPlayer } from 'expo-video';
import { ImageManipulator } from 'expo-image-manipulator';
import {
  requestUploadPresign,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { uploadChatVideoPoster } from './chat-video-poster';

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

function mockPlayer(frames: unknown[] | Error) {
  const player = {
    replaceAsync: jest.fn((): Promise<void> => Promise.resolve()),
    generateThumbnailsAsync: jest.fn(() =>
      frames instanceof Error ? Promise.reject(frames) : Promise.resolve(frames),
    ),
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
    // iOS attaches the item in a background task; asking for frames earlier returns [] and the
    // video goes out with no poster (a black bubble).
    const player = mockPlayer([{ width: 512, height: 288 }]);
    let finishLoading!: () => void;
    player.replaceAsync.mockReturnValueOnce(new Promise<void>((resolve) => { finishLoading = resolve; }));
    const uploading = uploadChatVideoPoster('file:///picked/trip.mov', 42, 'trip.mov');
    await Promise.resolve();
    expect(player.generateThumbnailsAsync).not.toHaveBeenCalled();
    finishLoading();
    await expect(uploading).resolves.toEqual({ key: 'chat/me/poster.jpg' });
    expect(player.generateThumbnailsAsync).toHaveBeenCalledTimes(1);
  });

  it('uses the very first frame of a clip shorter than a second', async () => {
    const player = mockPlayer([{ width: 512, height: 288 }]);
    await uploadChatVideoPoster('file:///picked/blink.mp4', 1, 'blink.mp4');
    expect(player.generateThumbnailsAsync).toHaveBeenCalledWith(0, { maxWidth: 512 });
  });

  it('gives up quietly (and still releases the player) when no frame can be read', async () => {
    const player = mockPlayer(new Error('unsupported codec'));
    await expect(
      uploadChatVideoPoster('file:///picked/odd.mkv', 10, 'odd.mkv'),
    ).resolves.toBeNull();
    expect(mockPresign).not.toHaveBeenCalled();
    expect(player.release).toHaveBeenCalled();
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
