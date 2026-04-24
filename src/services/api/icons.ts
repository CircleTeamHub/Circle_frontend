import { apiClient } from '@/services/api/client';
import { normalizeMediaUrl } from '@/services/api/utils';
import type { DisplayIcon, IconOption } from '@/types';

export type IconOptionsResponse = {
  systemIcons: IconOption[];
  circleIcons: IconOption[];
  displayIcons: DisplayIcon[];
};

export type UpdateDisplayIconInput = {
  displayType: 'SYSTEM' | 'CIRCLE';
  sortOrder: number;
  systemKey?: 'VIP' | 'NEW_USER';
  circleId?: string;
};

function normalizeOption(option: IconOption): IconOption {
  return {
    ...option,
    imageUrl: normalizeMediaUrl(option.imageUrl),
  };
}

function normalizeDisplayIcon(icon: DisplayIcon): DisplayIcon {
  return {
    ...icon,
    imageUrl: normalizeMediaUrl(icon.imageUrl),
  };
}

export async function fetchIconOptions(): Promise<IconOptionsResponse> {
  const response = await apiClient<IconOptionsResponse>('/icon/options');

  return {
    systemIcons: response.systemIcons.map(normalizeOption),
    circleIcons: response.circleIcons.map(normalizeOption),
    displayIcons: response.displayIcons.map(normalizeDisplayIcon),
  };
}

export async function updateDisplayIcons(
  items: UpdateDisplayIconInput[],
): Promise<DisplayIcon[]> {
  const response = await apiClient<DisplayIcon[]>('/icon/display', {
    method: 'PUT',
    body: { items },
  });

  return response.map(normalizeDisplayIcon);
}
