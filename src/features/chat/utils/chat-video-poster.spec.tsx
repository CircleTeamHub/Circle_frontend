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
      uploadChatVideoPoster('file:///picked/trip.mov', 42, 'trip.mov'),
    ).resolves.toEqual({ key: 'chat/me/poster.jpg' });

    expect(mockCreateVideoPlayer).toHaveBeenCalledWith('file:///picked/trip.mov');
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
    );
    // 播放器不跟组件走,用完必须手动释放,否则原生解码器一直占着。
    expect(player.release).toHaveBeenCalled();
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
});
