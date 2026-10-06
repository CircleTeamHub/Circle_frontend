import { normalizeMediaUrl } from '@/services/api/utils';
import type { ImageMediaVariant } from '@/types';

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === 'object' ? (value as RecordLike) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function urlValue(value: unknown): string | null {
  const raw = stringValue(value);
  return raw ? normalizeMediaUrl(raw) ?? raw : null;
}

/**
 * Accept both the new named fields and the short fields used by media gateways.
 * This is intentionally tolerant so an older server can deploy independently
 * from the client without making an otherwise valid post disappear.
 */
export function normalizeImageMediaVariant(value: unknown): ImageMediaVariant | null {
  const record = asRecord(value);
  if (!record) return null;

  const thumb = urlValue(record.thumb ?? record.thumbUrl);
  const preview = urlValue(record.preview ?? record.previewUrl);
  const original = urlValue(
    record.original ?? record.originalUrl ?? record.url,
  );
  const variant: ImageMediaVariant = {
    ...(thumb ? { thumb, thumbUrl: thumb } : {}),
    ...(preview ? { preview, previewUrl: preview } : {}),
    ...(original ? { original, originalUrl: original } : {}),
    ...(stringValue(record.key) ? { key: stringValue(record.key) } : {}),
    ...(stringValue(record.thumbKey)
      ? { thumbKey: stringValue(record.thumbKey) }
      : {}),
    ...(stringValue(record.previewKey)
      ? { previewKey: stringValue(record.previewKey) }
      : {}),
    ...(stringValue(record.originalKey)
      ? { originalKey: stringValue(record.originalKey) }
      : {}),
    ...(numberValue(record.width) ? { width: numberValue(record.width) } : {}),
    ...(numberValue(record.height)
      ? { height: numberValue(record.height) }
      : {}),
  };

  return thumb || preview || original || variant.key || variant.thumbKey
    ? variant
    : null;
}

export interface NormalizedImageMedia {
  /** Legacy-compatible original URL list used by existing callers. */
  images: string[];
  /** New optional metadata, in the same order as images where possible. */
  media: ImageMediaVariant[];
}

/** Normalize old `images: string[]` and new `media: ImageMediaVariant[]`. */
export function normalizeImageMedia(
  imagesValue: unknown,
  mediaValue?: unknown,
): NormalizedImageMedia {
  const rawImages = Array.isArray(imagesValue) ? imagesValue : [];
  const rawMedia = Array.isArray(mediaValue)
    ? mediaValue
    : rawImages.some((item) => typeof item !== 'string')
      ? rawImages
      : [];

  const images: string[] = [];
  const media: ImageMediaVariant[] = [];
  const count = Math.max(rawImages.length, rawMedia.length);

  for (let index = 0; index < count; index += 1) {
    const legacyUrl = urlValue(rawImages[index]);
    const variant = normalizeImageMediaVariant(rawMedia[index]);
    // If a server returns a separate images list, it remains the final fallback
    // for an otherwise metadata-only item.
    const original =
      variant?.originalUrl ?? variant?.original ?? legacyUrl ?? variant?.previewUrl ?? variant?.preview ?? variant?.thumbUrl ?? variant?.thumb;
    if (!original && !variant) continue;
    images.push(original ?? '');
    // Preserve positional alignment whenever the response used the new media
    // field (an empty object is a safe legacy fallback for a missing entry).
    if (rawMedia.length > 0) media.push(variant ?? {});
  }

  return { images: images.filter(Boolean), media };
}
