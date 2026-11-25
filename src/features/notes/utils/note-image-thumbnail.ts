import { generateChatImageThumbnail } from '@/features/chat/utils/image-thumbnail';
import { reportHandledFailure } from '@/observability/report-failure';
import {
  requestUploadPresign,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useAuthStore } from '@/stores/authStore';

/**
 * 给笔记图片顺带传一张小图（宽 ≤ 512），返回它的 object key。
 *
 * 笔记列表每行只画一张 72pt 的封面，没有小图就得把整张原图（长边 2048、几百 KB）
 * 下载下来再解码。服务端把这个 key 存成该图片的 posterUrl，列表封面优先用它。
 *
 * 原图本身够小、或者生成/上传失败时返回 null：列表退回用原图，绝不因为小图挡住笔记上传。
 */
export async function uploadNoteImageThumbnail(
  uri: string,
  originalWidth: number | undefined,
  filename: string,
): Promise<string | null> {
  const { sessionEpoch } = useAuthStore.getState();
  const isCurrentSession = () => useAuthStore.getState().sessionEpoch === sessionEpoch;
  try {
    const thumbnail = await generateChatImageThumbnail(uri, originalWidth);
    if (!thumbnail || !isCurrentSession()) return null;

    const presign = await requestUploadPresign({
      filename: sanitizeUploadFilename(`thumb-${filename}`),
      contentType: 'image/jpeg',
      folder: 'notes',
      fileUri: thumbnail.uri,
    }, isCurrentSession);
    await uploadLocalFileToPresignedUrl(
      presign.uploadUrl,
      'image/jpeg',
      thumbnail.uri,
      presign.requiredHeaders,
      undefined,
      // 和原图一样走 iOS 前台会话：后台会话由系统排期，会拖住整批上传。
      { foreground: true },
    );
    return presign.key;
  } catch (error) {
    if (isCurrentSession()) reportHandledFailure('noteEditor', 'thumbnailUpload', error);
    return null;
  }
}
