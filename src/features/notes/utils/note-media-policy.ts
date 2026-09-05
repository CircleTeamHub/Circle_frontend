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
