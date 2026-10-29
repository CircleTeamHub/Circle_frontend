import { apiClient } from '@/services/api/client';
import { isDisplayIconShape } from '@/services/api/response-shapes';
import { allowPeerMediaUrl } from '@/services/api/utils';
import { expectShape, isPlainObject } from '@/utils/validate';
import type { DisplayIcon, IconOption, SystemIconKey } from '@/types';

export type IconOptionsResponse = {
  systemIcons: IconOption[];
  circleIcons: IconOption[];
  displayIcons: DisplayIcon[];
};

export type UpdateDisplayIconInput = {
  displayType: 'SYSTEM' | 'CIRCLE';
  sortOrder: number;
  systemKey?: SystemIconKey;
  systemVariant?: string;
  circleId?: string;
};

function normalizeOption(option: IconOption): IconOption {
  return {
    ...option,
    imageUrl: allowPeerMediaUrl(option.imageUrl),
  };
}

function normalizeDisplayIcon(icon: DisplayIcon): DisplayIcon {
  return {
    ...icon,
    imageUrl: allowPeerMediaUrl(icon.imageUrl),
  };
}

function isIconOption(value: unknown): value is IconOption {
  return (
    isPlainObject(value) &&
    (value.type === 'SYSTEM' || value.type === 'CIRCLE') &&
    typeof value.title === 'string' &&
    (value.imageUrl === null || typeof value.imageUrl === 'string') &&
    (value.fallbackIconName === null || typeof value.fallbackIconName === 'string') &&
    typeof value.selected === 'boolean'
  );
}

function isIconOptionsResponse(value: unknown): value is IconOptionsResponse {
  return (
    isPlainObject(value) &&
    Array.isArray(value.systemIcons) &&
    value.systemIcons.every(isIconOption) &&
    Array.isArray(value.circleIcons) &&
    value.circleIcons.every(isIconOption) &&
    Array.isArray(value.displayIcons) &&
    value.displayIcons.every(isDisplayIconShape)
  );
}

export async function fetchIconOptions(): Promise<IconOptionsResponse> {
  const raw = await apiClient<unknown>('/icon/options');
  const response = expectShape(
    raw,
    isIconOptionsResponse,
    '图标配置数据格式异常',
  );

  return {
    systemIcons: response.systemIcons.map(normalizeOption),
    circleIcons: response.circleIcons.map(normalizeOption),
    displayIcons: response.displayIcons.map(normalizeDisplayIcon),
  };
}

export async function updateDisplayIcons(
  items: UpdateDisplayIconInput[],
): Promise<DisplayIcon[]> {
  const raw = await apiClient<unknown>('/icon/display', {
    method: 'PUT',
    body: { items },
  });

  return expectShape(
    raw,
    (value): value is DisplayIcon[] =>
      Array.isArray(value) && value.every(isDisplayIconShape),
    '图标配置数据格式异常',
  ).map(normalizeDisplayIcon);
}
