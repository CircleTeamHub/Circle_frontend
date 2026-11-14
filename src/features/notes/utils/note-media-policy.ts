// 不能超过上传链路自己的上限：services/api/upload.ts 的 MAX_UPLOAD_BYTES 与后端
// PresignDto 的 @Max 都卡在 100MB。这里放宽的话，100~200MB 的视频会通过本地策略
// 校验、生成 PENDING 草稿，然后在 presign 阶段被拒——而批量上传只回传失败条数，
// 用户只会看到「N 个文件上传失败」，永远不知道是文件太大。
export const MAX_NOTE_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_NOTE_VIDEO_DURATION_MS = 10 * 60 * 1000;

export type NoteVideoUploadPolicyViolation = 'size' | 'duration';

export function getNoteVideoUploadPolicyViolation({
  fileSize,
  duration,
}: {
  fileSize?: number | null;
  duration?: number | null;
}): NoteVideoUploadPolicyViolation | null {
  if (typeof fileSize === 'number' && fileSize > MAX_NOTE_VIDEO_BYTES) {
    return 'size';
  }
  if (typeof duration === 'number' && duration > MAX_NOTE_VIDEO_DURATION_MS) {
    return 'duration';
  }
  return null;
}

/**
 * 每条笔记各类媒体的数量上限,与服务端 circle_be src/note/note-media-limits.ts 同一组数字。
 * 这里只负责选择器限量和提示;真正的闸门在服务端(上限前就已超的旧笔记,编辑时不拦,只拦再往上加)。
 */
export const NOTE_MEDIA_TYPE_LIMITS = {
  photos: 9,
  videos: 5,
  verificationVideos: 5,
} as const;

export type NoteMediaLimitType = keyof typeof NOTE_MEDIA_TYPE_LIMITS;

/** 「添加图片」算照片,「添加视频」算视频,验证区的「添加验证视频」算验证视频。 */
export function noteMediaLimitTypeFor(
  target: 'media' | 'showcase',
  kind: 'image' | 'video',
): NoteMediaLimitType {
  if (target === 'showcase') return 'verificationVideos';
  return kind === 'image' ? 'photos' : 'videos';
}

/** 这条笔记这一类还能再加几个;上限前就已超的旧笔记是 0。 */
export function remainingNoteMediaSlots(
  type: NoteMediaLimitType,
  mediaItems: readonly { type: string }[],
  showcaseItems: readonly { type: string }[],
): number {
  const used =
    type === 'photos'
      ? [...mediaItems, ...showcaseItems].filter((item) => item.type === 'IMAGE').length
      : (type === 'videos' ? mediaItems : showcaseItems).filter((item) => item.type === 'VIDEO').length;
  return Math.max(0, NOTE_MEDIA_TYPE_LIMITS[type] - used);
}

/** 选多了(网页端/安卓的选择器不一定守 selectionLimit):按选择顺序留前 remaining 个。 */
export function fitPickedAssetsToNoteMediaLimit<T>(assets: readonly T[], remaining: number) {
  return { kept: assets.slice(0, remaining), dropped: assets.slice(remaining) };
}
