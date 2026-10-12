import { ApiError } from '@/services/api/api-error';
import { shouldUseDirectVideoExportFallback } from './note-export';

test('falls back to direct video downloads for export size failures', () => {
  expect(
    shouldUseDirectVideoExportFallback(
      new ApiError('too large', {
        status: 413,
        errorCode: 'UPLOAD_PAYLOAD_TOO_LARGE',
      }),
    ),
  ).toBe(true);
  expect(
    shouldUseDirectVideoExportFallback(
      new ApiError('too large', {
        status: 400,
        errorCode: 'NOTE_EXPORT_MEDIA_TOO_LARGE',
      }),
    ),
  ).toBe(true);
  expect(
    shouldUseDirectVideoExportFallback(
      new ApiError('too large', {
        status: 400,
        errorCode: 'NOTE_EXPORT_TOTAL_TOO_LARGE',
      }),
    ),
  ).toBe(true);
});

test('does not hide unrelated export failures behind direct downloads', () => {
  expect(
    shouldUseDirectVideoExportFallback(
      new ApiError('forbidden', {
        status: 403,
        errorCode: 'NOTE_NOT_FOUND',
      }),
    ),
  ).toBe(false);
  expect(shouldUseDirectVideoExportFallback(new Error('network error'))).toBe(false);
});
