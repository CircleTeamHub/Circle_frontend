export const MAX_NOTE_VIDEO_BYTES = 200 * 1024 * 1024;
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
