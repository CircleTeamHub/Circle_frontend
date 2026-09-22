import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import {
  requestUploadPresign,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';

const POSTER_MAX_WIDTH = 512;
const POSTER_JPEG_QUALITY = 0.7;
/** 很多视频第一帧是黑的(淡入、相机刚启动),取第 0.5 秒;不到一秒的短片取第一帧。 */
const POSTER_FRAME_SECONDS = 0.5;

async function generateChatVideoPoster(
  uri: string,
  durationSeconds: number | undefined,
): Promise<{ uri: string } | null> {
  let player: VideoPlayer | null = null;
  try {
    player = createVideoPlayer(uri);
    const at =
      typeof durationSeconds === 'number' && durationSeconds > 1
        ? POSTER_FRAME_SECONDS
        : 0;
    const [frame] = await player.generateThumbnailsAsync(at, {
      maxWidth: POSTER_MAX_WIDTH,
    });
    if (!frame) return null;
    const rendered = await ImageManipulator.manipulate(frame).renderAsync();
    const saved = await rendered.saveAsync({
      compress: POSTER_JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    return { uri: saved.uri };
  } catch {
    return null;
  } finally {
    // 这个播放器不跟组件走,用完必须手动释放,否则原生解码器一直占着。
    player?.release();
  }
}

/**
 * 给聊天视频截一帧封面并上传,返回封面的 object key(写进消息的 thumbKey,服务端读时
 * 签成 thumbUrl)。原来视频没有封面,气泡在点播放之前是一块黑框,聊天记录的媒体宫格
 * 里也只能显示占位卡片。
 *
 * 截不到帧或上传失败返回 null:封面可有可无,视频照常发。
 */
export async function uploadChatVideoPoster(
  uri: string,
  durationSeconds: number | undefined,
  filename: string,
): Promise<{ key: string } | null> {
  try {
    const poster = await generateChatVideoPoster(uri, durationSeconds);
    if (!poster) return null;
    const base = filename.replace(/\.[^./]*$/, '') || 'video';
    const presign = await requestUploadPresign({
      filename: sanitizeUploadFilename(`poster-${base}.jpg`),
      contentType: 'image/jpeg',
      folder: 'chat',
      fileUri: poster.uri,
    });
    await uploadLocalFileToPresignedUrl(
      presign.uploadUrl,
      'image/jpeg',
      poster.uri,
      presign.requiredHeaders,
    );
    // chat/ 是私有目录:消息体只存 object key,读时由服务端签 URL。
    return { key: presign.key };
  } catch {
    return null;
  }
}
