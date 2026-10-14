import nightLayout from '../../../assets/splash/night-layout.json';

/** 设计稿 → 屏幕的 cover 映射（与 iOS 原生启动图 scaleAspectFill 一致）。 */
export interface CoverFrame {
  /** 设计稿 1px 对应的屏幕 pt。 */
  scale: number;
  /** 设计稿左上角在屏幕上的位置（可能为负：被裁掉的部分）。 */
  offsetX: number;
  offsetY: number;
}

export function getCoverFrame(screenWidth: number, screenHeight: number): CoverFrame {
  const scale = Math.max(
    screenWidth / nightLayout.width,
    screenHeight / nightLayout.height,
  );
  return {
    scale,
    offsetX: (screenWidth - nightLayout.width * scale) / 2,
    offsetY: (screenHeight - nightLayout.height * scale) / 2,
  };
}
