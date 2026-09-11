import { parseHexColor } from './tokens';
import type { ResolvedMode } from './types';

/** 暗色下往白色混合的比例：保留原色相，只把明度抬到读得清的档位。 */
const DARK_BLEND = 0.4;

/**
 * 为独立配色的图标生成暗色前景色，保留原色相和浅色模式的显示。
 *
 * 只认 `#RRGGBB` / `#RGB`；服务端下发的任意颜色字符串（rgba()/命名色）原样返回，
 * 暗色下不提亮 —— 这些值不在色板里，没有可推导的安全亮度。
 */
export function iconForeground(color: string, mode: ResolvedMode): string {
  if (mode !== 'dark') return color;
  const rgb = parseHexColor(color);
  if (!rgb) return color;

  const channels = rgb.map((channel) =>
    Math.round(channel + (255 - channel) * DARK_BLEND)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${channels.join('')}`;
}
