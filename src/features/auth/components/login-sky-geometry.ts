/**
 * 「夜航」登录页 hero 的几何常量。
 *
 * 一切以 390×330 的设计稿坐标系描述（星点、航迹、飞机位置、标题顶边），
 * 运行时由 getSkyLayout 按屏宽等比缩放。点位是静态数据而不是随机生成：
 * 每次渲染一致、可以在 node 测试里校验边界，也不会因为重渲染而"抖动"。
 */

export const SKY_WIDTH = 390;
export const SKY_HEIGHT = 330;
/** 窄屏下限：再窄也按 320 铺，允许两侧各溢出几像素。 */
export const SKY_MIN_WIDTH = 320;
/** 平板 / 桌面网页上限：hero 不跟着无限放大，居中即可。 */
export const SKY_MAX_WIDTH = 480;
/** 标题「欢迎回来」在设计稿里的顶边；表单列从这里开始。 */
export const HERO_CONTENT_TOP = 292;
/** 标题所在区域：星点不进来，避免文字后面有亮点。 */
export const HEADING_ZONE = { right: 230, top: 288 } as const;

/** 飞机 PNG 的落位（设计稿坐标，未缩放）。 */
export const PLANE_BOX = { left: 230, top: 130, size: 96, rotate: -12 } as const;
/** 暗色：飞机背后的紫色星云；亮色：右上角的薄雾。 */
export const NEBULA = { cx: 278, cy: 178, r: 140 } as const;
export const DAY_HAZE = { cx: 330, cy: 120, r: 160 } as const;

/** 航迹：从空中起笔、拐一个 S、收在机尾。 */
export const TRAIL_PATH =
  'M166 104 C150 140 130 200 150 238 C168 268 214 236 238 204';
export const TRAIL_START = { x: 166, y: 104 } as const;
export const TRAIL_END = { x: 238, y: 204 } as const;
/** 暗色航迹光晕：三层由宽到窄、由淡到亮叠在细线下面。 */
export const TRAIL_BLOOM = [
  { width: 28, opacity: 0.06 },
  { width: 14, opacity: 0.14 },
  { width: 6, opacity: 0.35 },
] as const;

export interface SkyStar {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

export interface SkySparkle {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

const star = (x: number, y: number, r: number, opacity: number): SkyStar => ({
  x,
  y,
  r,
  opacity,
});

/** 暗色夜空的白色星点：全部 ≤ 45% 白，只有三颗稍亮。 */
export const NIGHT_STARS: readonly SkyStar[] = [
  star(22, 40, 1, 0.2),
  star(58, 22, 1.5, 0.3),
  star(96, 66, 1, 0.15),
  star(140, 30, 1, 0.25),
  star(176, 58, 1.5, 0.2),
  star(214, 18, 1, 0.3),
  star(250, 44, 1, 0.15),
  star(292, 26, 1.5, 0.25),
  star(334, 54, 1, 0.2),
  star(366, 20, 1, 0.3),
  star(44, 96, 1.5, 0.15),
  star(120, 102, 1, 0.2),
  star(196, 88, 1, 0.15),
  star(238, 72, 1.5, 0.3),
  star(310, 92, 1, 0.2),
  star(352, 110, 1, 0.15),
  star(28, 140, 1, 0.25),
  star(76, 150, 1.5, 0.2),
  star(164, 146, 1, 0.15),
  star(350, 150, 1.5, 0.25),
  star(372, 182, 1, 0.2),
  star(14, 190, 1, 0.15),
  star(60, 214, 1.5, 0.3),
  star(110, 232, 1, 0.2),
  star(210, 262, 1, 0.15),
  star(262, 246, 1.5, 0.2),
  star(318, 236, 1, 0.3),
  star(360, 262, 1, 0.2),
  star(36, 270, 1, 0.25),
  star(150, 286, 1.5, 0.15),
  star(232, 300, 1, 0.2),
  star(300, 292, 1, 0.15),
  star(70, 282, 1, 0.3),
  star(240, 318, 1.5, 0.2),
  star(340, 318, 1, 0.25),
  star(128, 178, 1, 0.2),
  star(330, 36, 1.5, 0.45),
  star(70, 120, 1.5, 0.45),
  star(290, 270, 1.5, 0.45),
];

/** 亮色日间版的品牌紫小星点。 */
export const DAY_DOTS: readonly SkyStar[] = [
  star(30, 40, 2, 0.35),
  star(70, 30, 1.5, 0.3),
  star(150, 28, 2, 0.3),
  star(200, 52, 1.5, 0.35),
  star(260, 30, 2, 0.3),
  star(340, 24, 1.5, 0.3),
  star(372, 72, 2, 0.35),
  star(176, 150, 1.5, 0.3),
  star(56, 120, 2, 0.3),
  star(28, 160, 1.5, 0.35),
  star(100, 176, 2, 0.3),
  star(350, 180, 1.5, 0.3),
  star(376, 214, 2, 0.35),
  star(190, 262, 1.5, 0.3),
  star(300, 232, 2, 0.3),
  star(360, 300, 1.5, 0.3),
  star(80, 250, 2, 0.3),
  star(140, 228, 1.5, 0.3),
  star(240, 96, 2, 0.3),
  star(120, 140, 1.5, 0.35),
];

/** 亮色日间版的四角小星。 */
export const DAY_SPARKLES: readonly SkySparkle[] = [
  { x: 306, y: 46, size: 8, opacity: 0.55 },
  { x: 96, y: 52, size: 6, opacity: 0.6 },
  { x: 356, y: 118, size: 7, opacity: 0.45 },
  { x: 44, y: 206, size: 6, opacity: 0.5 },
  { x: 330, y: 262, size: 5, opacity: 0.4 },
  { x: 206, y: 26, size: 5, opacity: 0.45 },
];

/** 以原点为中心、四个尖角内凹的小星星路径（配合 translate 放到点位上）。 */
export function sparklePath(size: number): string {
  return `M0 ${-size} Q0 0 ${size} 0 Q0 0 0 ${size} Q0 0 ${-size} 0 Q0 0 0 ${-size} Z`;
}

export interface SkyLayout {
  /** 设计稿 → 屏幕的缩放系数。 */
  scale: number;
  /** hero 实际铺的宽度（已夹在 [SKY_MIN_WIDTH, SKY_MAX_WIDTH] 内）。 */
  width: number;
  height: number;
  /** 表单列的 paddingTop：标题顶边随 hero 一起缩放。 */
  contentTop: number;
  /** hero 相对屏幕左边的偏移：宽屏居中，窄屏可能为负（两侧溢出）。 */
  offsetX: number;
}

export function getSkyLayout(screenWidth: number): SkyLayout {
  const width = Math.min(Math.max(screenWidth, SKY_MIN_WIDTH), SKY_MAX_WIDTH);
  const scale = width / SKY_WIDTH;
  return {
    scale,
    width,
    height: SKY_HEIGHT * scale,
    contentTop: HERO_CONTENT_TOP * scale,
    offsetX: (screenWidth - width) / 2,
  };
}
