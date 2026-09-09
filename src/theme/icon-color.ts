import type { ResolvedMode } from './types';

/** 为独立配色的图标生成暗色前景色，保留原色相和浅色模式的显示。 */
export function iconForeground(color: string, mode: ResolvedMode): string {
  if (mode !== 'dark' || !/^#[0-9a-f]{6}$/i.test(color)) return color;

  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16);
    return Math.round(channel + (255 - channel) * 0.4)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}
