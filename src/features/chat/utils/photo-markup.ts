export type PhotoMarkupTool = 'mosaic' | 'draw';

export interface NormalizedMarkupPoint {
  x: number;
  y: number;
}

export interface PhotoMarkupStroke {
  id: string;
  tool: PhotoMarkupTool;
  color: string;
  /** 笔刷宽度占照片较短边的比例，保证预览和导出尺寸一致。 */
  widthRatio: number;
  points: NormalizedMarkupPoint[];
}

export interface RenderedMarkupStroke
  extends Omit<PhotoMarkupStroke, 'points' | 'widthRatio'> {
  strokeWidth: number;
  points: NormalizedMarkupPoint[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeMarkupPoint(
  x: number,
  y: number,
  width: number,
  height: number,
): NormalizedMarkupPoint | null {
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    x: clamp(x / width, 0, 1),
    y: clamp(y / height, 0, 1),
  };
}

export function appendMarkupPoint(
  stroke: PhotoMarkupStroke,
  point: NormalizedMarkupPoint,
  minimumDistance = 0.003,
): PhotoMarkupStroke {
  const last = stroke.points[stroke.points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < minimumDistance) {
    return stroke;
  }
  return { ...stroke, points: [...stroke.points, point] };
}

export function renderMarkupStroke(
  stroke: PhotoMarkupStroke,
  width: number,
  height: number,
): RenderedMarkupStroke | null {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    stroke.points.length === 0
  ) {
    return null;
  }
  return {
    id: stroke.id,
    tool: stroke.tool,
    color: stroke.color,
    strokeWidth: Math.max(1, stroke.widthRatio * Math.min(width, height)),
    points: stroke.points.map((point) => ({
      x: clamp(point.x, 0, 1) * width,
      y: clamp(point.y, 0, 1) * height,
    })),
  };
}
