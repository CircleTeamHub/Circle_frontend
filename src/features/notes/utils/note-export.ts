import { ApiError } from '@/services/api/api-error';

/**
 * The export endpoint creates an archive and rejects oversized media before it
 * returns a share URL. In that case the detail response's signed video URLs can
 * be downloaded directly instead.
 */
export function shouldUseDirectVideoExportFallback(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return (
    error.status === 413 ||
    error.errorCode === 'NOTE_EXPORT_MEDIA_TOO_LARGE' ||
    error.errorCode === 'NOTE_EXPORT_TOTAL_TOO_LARGE'
  );
}
