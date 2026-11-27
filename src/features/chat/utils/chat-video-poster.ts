import { Platform } from 'react-native';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { reportHandledFailure } from '@/observability/report-failure';
import {
  requestUploadPresign,
  sanitizeUploadFilename,
  type UploadPurpose,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';

const POSTER_MAX_WIDTH = 512;
const POSTER_JPEG_QUALITY = 0.7;
/** 很多视频第一帧是黑的(淡入、相机刚启动),取第 0.5 秒;不到一秒的短片取第一帧。 */
const POSTER_FRAME_SECONDS = 0.5;
/** 等视频挂上播放器的上限:截不到封面视频照常发,不能把发送流程挂住。 */
const POSTER_LOAD_TIMEOUT_MS = 8_000;

/**
 * 等视频真正挂到播放器上再截帧。iOS 上 replaceAsync 只等到资源加载完,挂 currentItem 那一步
 * 又被丢回主线程异步做(expo-video VideoPlayer.replaceCurrentItem),promise 先回来;这时截帧
 * 拿到空数组、时长也还是 0,视频就偶尔没封面。readyToPlay 才说明视频已挂上。
 * 与笔记 VideoDraftPreview 的 loadForThumbnail 同一套写法。
 */
function loadForThumbnail(player: VideoPlayer, uri: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      subscription.remove();
      if (error === undefined) resolve();
      else reject(error);
    };
    const timer = setTimeout(
      () => finish(new Error('video poster load timed out')),
      POSTER_LOAD_TIMEOUT_MS,
    );
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') finish();
      else if (status === 'error') finish(new Error(error?.message ?? 'video failed to load'));
    });
    player.replaceAsync(uri).then(
      () => {
        // Android(和偶尔够快的 iOS)回来时已经 readyToPlay,不会再发一次事件。
        if (player.status === 'readyToPlay') finish();
      },
      (error: unknown) => finish(error),
    );
  });
}

/**
 * 从视频(本机文件或远端地址)截一帧,存成本机 JPEG。截不到返回 null。
 * 不支持 Web(expo-video 在 Web 上没有截帧)。
 */
export async function captureVideoPosterFrame(
  uri: string,
  durationSeconds: number | undefined,
): Promise<{ uri: string } | null> {
  // 网页上 expo-video 没有截帧，调了必然失败；以前每次都当错误上报（Sentry「chatVideoPoster 失败」）。
  if (Platform.OS === 'web') return null;
  let player: VideoPlayer | null = null;
  try {
    // createVideoPlayer(uri) 也是在后台任务里挂视频,同样会截到空数组,所以先建空播放器再等加载。
    player = createVideoPlayer(null);
    await loadForThumbnail(player, uri);
    // 调用方不知道时长(补截老消息的封面)时用加载后读到的时长,不然一律截第一帧、常是黑的。
    const duration = durationSeconds ?? player.duration;
    const at = duration > 1 ? POSTER_FRAME_SECONDS : 0;
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
  } catch (error) {
    // 截帧失败 = 气泡没封面、一块黑。原来静默吞掉,线上完全看不出是哪一步、哪个平台坏了。
    reportHandledFailure('chatVideoPoster', 'captureFrame', error);
    return null;
  } finally {
    // 这个播放器不跟组件走,用完必须手动释放,否则原生解码器一直占着。
    player?.release();
  }
}

/**
 * 给聊天视频截一帧封面并上传,返回封面的 object key(写进消息的 thumbKey,服务端读时
 * 签成 thumbUrl)。朋友圈可指定 posts 目录，读取时同样按 key 生成公开封面 URL。
 * 原来视频没有封面,气泡在点播放之前是一块黑框,聊天记录的媒体宫格
 * 里也只能显示占位卡片。
 *
 * 截不到帧或上传失败返回 null:封面可有可无,视频照常发。
 */
export async function uploadChatVideoPoster(
  uri: string,
  durationSeconds: number | undefined,
  filename: string,
  folder: 'chat' | 'posts' = 'chat',
  beforeUpload?: () => void,
  progressKey?: string,
  purpose?: UploadPurpose,
): Promise<{ key: string } | null> {
  try {
    const poster = await captureVideoPosterFrame(uri, durationSeconds);
    if (!poster) return null;
    const base = filename.replace(/\.[^./]*$/, '') || 'video';
    const presign = await requestUploadPresign({
      filename: sanitizeUploadFilename(`poster-${base}.jpg`),
      contentType: 'image/jpeg',
      folder,
      ...(purpose ? { purpose } : {}),
      fileUri: poster.uri,
    });
    beforeUpload?.();
    await uploadLocalFileToPresignedUrl(
      presign.uploadUrl,
      'image/jpeg',
      poster.uri,
      presign.requiredHeaders,
      undefined,
      progressKey ? { progressKey } : undefined,
    );
    // chat/ 是私有目录:消息体只存 object key,读时由服务端签 URL。
    return { key: presign.key };
  } catch {
    return null;
  }
}
