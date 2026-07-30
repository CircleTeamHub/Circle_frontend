import { apiClient } from '@/services/api/client';
import { normalizeAvatarFrameImageUrl } from '@/services/api/utils';
import type {
  AvatarFrameAppearance,
  AvatarFrameInventory,
  AvatarFrameInventoryItem,
  AvatarFrameOwnedSource,
  UserAppearance,
} from '@/types';

export class AvatarFrameResponseValidationError extends Error {
  readonly endpoint: string;
  readonly detail: string;

  constructor(endpoint: string, detail: string) {
    super(`Malformed ${endpoint} response: ${detail}`);
    this.name = 'AvatarFrameResponseValidationError';
    this.endpoint = endpoint;
    this.detail = detail;
  }
}

const invalidAppearanceIds = new WeakMap<
  Record<string, UserAppearance>,
  readonly string[]
>();

function malformed(endpoint: string, detail: string): never {
  throw new AvatarFrameResponseValidationError(endpoint, detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nullableString(
  value: unknown,
  endpoint: string,
  field: string,
): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    malformed(endpoint, `${field} must be a string or null`);
  }
  return value;
}

function finiteNumber(value: unknown, endpoint: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    malformed(endpoint, `${field} must be a finite number`);
  }
  return value;
}

function vipLevel(value: unknown, endpoint: string, field: string): number {
  const level = finiteNumber(value, endpoint, field);
  if (!Number.isInteger(level) || level < 0 || level > 4) {
    malformed(endpoint, `${field} must be an integer from 0 to 4`);
  }
  return level;
}

function parseMinimumVipLevel(
  value: unknown,
  endpoint: string,
  field: string,
): number {
  const level = finiteNumber(value, endpoint, field);
  if (!Number.isInteger(level) || level < 1 || level > 4) {
    malformed(endpoint, `${field} must be an integer from 1 to 4`);
  }
  return level;
}

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function nullableIsoDateTime(
  value: unknown,
  endpoint: string,
  field: string,
): string | null {
  const timestamp = nullableString(value, endpoint, field);
  if (
    timestamp !== null &&
    (!ISO_DATE_TIME_PATTERN.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp)))
  ) {
    malformed(endpoint, `${field} must be an ISO date-time string or null`);
  }
  return timestamp;
}

function parseAppearance(
  value: unknown,
  endpoint: string,
  field: string,
): AvatarFrameAppearance {
  if (!isRecord(value)) {
    malformed(endpoint, `${field} must be an object`);
  }
  if (
    typeof value.id !== 'string' ||
    value.id.trim().length === 0 ||
    typeof value.key !== 'string' ||
    typeof value.name !== 'string'
  ) {
    malformed(endpoint, `${field} has invalid identity fields`);
  }
  const rawImageUrl = nullableString(
    value.imageUrl,
    endpoint,
    `${field}.imageUrl`,
  );
  const imageUrl = normalizeAvatarFrameImageUrl(rawImageUrl);
  if (rawImageUrl !== null && imageUrl === null) {
    malformed(endpoint, `${field}.imageUrl is unsafe`);
  }
  return {
    id: value.id,
    key: value.key,
    name: value.name,
    imageUrl,
  };
}

function parseOwnedSource(
  value: unknown,
  endpoint: string,
  field: string,
): AvatarFrameOwnedSource {
  if (!isRecord(value)) {
    malformed(endpoint, `${field} must be an object`);
  }
  const expiresAt = nullableIsoDateTime(
    value.expiresAt,
    endpoint,
    `${field}.expiresAt`,
  );
  if (value.type === 'MEMBERSHIP') {
    return {
      type: 'MEMBERSHIP',
      minimumVipLevel: parseMinimumVipLevel(
        value.minimumVipLevel,
        endpoint,
        `${field}.minimumVipLevel`,
      ),
      expiresAt,
    };
  }
  if (value.type === 'ADMIN' && typeof value.grantId === 'string') {
    return {
      type: 'ADMIN',
      grantId: value.grantId,
      expiresAt,
    };
  }
  return malformed(endpoint, `${field} has an invalid source type`);
}

function parseInventoryItem(
  value: unknown,
  endpoint: string,
  index: number,
): AvatarFrameInventoryItem {
  const field = `items[${index}]`;
  const appearance = parseAppearance(value, endpoint, field);
  const item = value as Record<string, unknown>;
  if (
    typeof item.description !== 'string' ||
    !Array.isArray(item.ownedSources) ||
    typeof item.equipped !== 'boolean'
  ) {
    malformed(endpoint, `${field} has invalid inventory fields`);
  }
  const minimumVipLevel =
    item.minimumVipLevel === null
      ? null
      : parseMinimumVipLevel(
          item.minimumVipLevel,
          endpoint,
          `${field}.minimumVipLevel`,
        );
  return {
    ...appearance,
    description: item.description,
    minimumVipLevel,
    ownedSources: item.ownedSources.map((source, sourceIndex) =>
      parseOwnedSource(
        source,
        endpoint,
        `${field}.ownedSources[${sourceIndex}]`,
      ),
    ),
    availableUntil: nullableIsoDateTime(
      item.availableUntil,
      endpoint,
      `${field}.availableUntil`,
    ),
    equipped: item.equipped,
  };
}

function parseInventory(value: unknown): AvatarFrameInventory {
  const endpoint = '/avatar-frames/me';
  if (!isRecord(value) || !Array.isArray(value.items)) {
    malformed(endpoint, 'expected an inventory object');
  }
  const equippedFrameId = nullableString(
    value.equippedFrameId,
    endpoint,
    'equippedFrameId',
  );
  const items = value.items.map((item, index) =>
    parseInventoryItem(item, endpoint, index),
  );
  const itemIds = new Set(items.map((item) => item.id));
  if (itemIds.size !== items.length) {
    malformed(endpoint, 'items must have unique ids');
  }
  const equippedItems = items.filter((item) => item.equipped);
  if (
    (equippedFrameId === null && equippedItems.length !== 0) ||
    (equippedFrameId !== null &&
      (equippedItems.length !== 1 || equippedItems[0].id !== equippedFrameId))
  ) {
    malformed(
      endpoint,
      'equippedFrameId and items[].equipped are inconsistent',
    );
  }
  return {
    equippedFrameId,
    items,
  };
}

function parseUserAppearances(value: unknown): Record<string, UserAppearance> {
  const endpoint = '/user/appearances';
  if (!isRecord(value)) {
    malformed(endpoint, 'expected an object');
  }
  const result: Record<string, UserAppearance> = {};
  const invalidIds: string[] = [];
  for (const [id, rawAppearance] of Object.entries(value)) {
    try {
      if (!isRecord(rawAppearance)) {
        malformed(endpoint, `appearance for "${id}" must be an object`);
      }
      const avatarFrame =
        rawAppearance.avatarFrame === null
          ? null
          : parseAppearance(
              rawAppearance.avatarFrame,
              endpoint,
              `${id}.avatarFrame`,
            );
      result[id] = {
        vipLevel: vipLevel(rawAppearance.vipLevel, endpoint, `${id}.vipLevel`),
        avatarFrame,
      };
    } catch (error) {
      if (!(error instanceof AvatarFrameResponseValidationError)) {
        throw error;
      }
      invalidIds.push(id);
    }
  }
  invalidAppearanceIds.set(result, invalidIds);
  return result;
}

export function getInvalidUserAppearanceIds(
  result: Record<string, UserAppearance>,
): readonly string[] {
  return invalidAppearanceIds.get(result) ?? [];
}

export async function fetchAvatarFrameInventory(): Promise<AvatarFrameInventory> {
  const raw = await apiClient<unknown>('/avatar-frames/me');
  return parseInventory(raw);
}

export async function equipAvatarFrame(
  frameId: string | null,
): Promise<AvatarFrameInventory> {
  const raw = await apiClient<unknown>('/avatar-frames/me/equipped', {
    method: 'PUT',
    body: { frameId },
  });
  const inventory = parseInventory(raw);
  if (inventory.equippedFrameId !== frameId) {
    malformed(
      '/avatar-frames/me/equipped',
      'equippedFrameId does not match the requested frame',
    );
  }
  return inventory;
}

export async function fetchUserAppearances(
  ids: string[],
): Promise<Record<string, UserAppearance>> {
  if (ids.length === 0) {
    return {};
  }
  const raw = await apiClient<unknown>('/user/appearances', {
    method: 'POST',
    body: { ids },
  });
  return parseUserAppearances(raw);
}
