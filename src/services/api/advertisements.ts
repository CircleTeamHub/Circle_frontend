import { apiClient } from '@/services/api/client';
import i18n from '@/i18n';
import { isPlainObject } from '@/utils/validate';

export type Advertisement = {
  id: string;
  title: string;
  imageUrl: string;
  targetUrl: string;
  startsAt: string;
  endsAt: string;
};

export function isPublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) &&
      !/^[\d.]+$/.test(host) &&
      !/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(host);
  } catch {
    return false;
  }
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function isAdvertisement(value: unknown): value is Advertisement {
  return isPlainObject(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 200 &&
    isPublicHttpsUrl(value.imageUrl) && isPublicHttpsUrl(value.targetUrl) &&
    isDate(value.startsAt) && isDate(value.endsAt) &&
    Date.parse(value.startsAt) < Date.parse(value.endsAt);
}

export function isAdvertisementActive(ad: Advertisement, now = Date.now()): boolean {
  return Date.parse(ad.startsAt) <= now && Date.parse(ad.endsAt) > now;
}

export async function fetchAdvertisements(): Promise<Advertisement[]> {
  const raw = await apiClient<unknown>('/advertisements?placement=CIRCLE_HOME');
  if (!Array.isArray(raw) || raw.length > 10 || !raw.every(isAdvertisement) ||
      new Set(raw.map((ad) => ad.id)).size !== raw.length) {
    throw new Error(i18n.t('common.errors.invalidServerResponse'));
  }
  return raw.filter((ad) => isAdvertisementActive(ad));
}
