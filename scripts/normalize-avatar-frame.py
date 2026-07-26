#!/usr/bin/env python3
"""把任意来源的圆形头像框 PNG 归一化成本项目的素材契约。

契约(见 assets/frames/README.md):正方形透明 PNG,环的内圆直径 = 画布边长 × 78.125%。
装饰允许压在头像区上(渲染时框叠在头像之上),因此内圆不是「最大空圆」,而是
「环的内边缘圆」——本脚本用稳健圆拟合测它:720 条射线取首撞距离,以分位段剔除
被皇冠/翅膀等装饰截短的射线,再最小二乘拟合圆心与半径。

用法:
  python3 scripts/normalize-avatar-frame.py <输入.png> <输出.png> [孔直径px]
  第三个参数可选:自动测量不准时手动指定源图内孔直径。
依赖:pillow + numpy (pip install pillow numpy)
"""
import sys
import math
import numpy as np
from PIL import Image

HOLE_RATIO = 0.625   # 内孔直径 / 画布边长 (= 1 / AVATAR_FRAME_SCALE 1.6)
OUT_SIZE = 1024


def ray_first_hits(solid: np.ndarray, cx: float, cy: float, n_rays: int = 720):
    """从 (cx,cy) 出发 n_rays 条射线,返回每条「首次撞到不透明像素」的距离(未撞到=NaN)。"""
    h, w = solid.shape
    max_r = min(w, h) / 2
    angs = np.linspace(0, 2 * math.pi, n_rays, endpoint=False)
    rs = np.arange(2.0, max_r, 1.0)
    xs = (cx + np.cos(angs)[:, None] * rs[None, :]).astype(int).clip(0, w - 1)
    ys = (cy + np.sin(angs)[:, None] * rs[None, :]).astype(int).clip(0, h - 1)
    hits = solid[ys, xs]
    any_hit = hits.any(axis=1)
    d = np.where(any_hit, rs[hits.argmax(axis=1)], np.nan)
    return angs, d


def fit_inner_circle(solid: np.ndarray) -> tuple[float, float, float]:
    """稳健拟合环内圆。真圆心偏离当前射线原点 t 时,首撞距离满足
    d(θ) ≈ R + tx·cosθ + ty·sinθ(小偏心线性化),最小二乘解出 (R, tx, ty)
    后把原点移向真圆心;只用分位段 [55%, 97%] 的射线(剔除装饰截短的
    短射线与漏网长射线),迭代收敛。"""
    ys, xs = np.where(solid)
    cx = (xs.min() + xs.max()) / 2
    cy = (ys.min() + ys.max()) / 2
    R = 0.0
    for _ in range(8):
        angs, d = ray_first_hits(solid, cx, cy)
        ok = ~np.isnan(d)
        lo, hi = np.nanpercentile(d[ok], 55), np.nanpercentile(d[ok], 97)
        clean = ok & (d >= lo) & (d <= hi)
        if clean.sum() < 30:
            break
        A = np.stack([np.ones(clean.sum()), np.cos(angs[clean]), np.sin(angs[clean])], axis=1)
        (R, tx, ty), *_ = np.linalg.lstsq(A, d[clean], rcond=None)
        cx, cy = cx + tx, cy + ty
        if abs(tx) < 0.4 and abs(ty) < 0.4:
            break
    return cx, cy, R


def main(argv: list[str]) -> None:
    if len(argv) not in (3, 4):
        raise SystemExit(__doc__)
    src_path, dst_path = argv[1], argv[2]
    im = Image.open(src_path).convert('RGBA')
    a = np.asarray(im)[..., 3]
    solid = a > 8
    if not solid.any():
        raise SystemExit('输入图完全透明,不是有效素材')

    cx, cy, hole_r = fit_inner_circle(solid)
    if len(argv) == 4:  # 手动指定孔直径(仍用拟合出的圆心)
        hole_r = float(argv[3]) / 2
    if hole_r < 8:
        raise SystemExit('找不到中心内孔——素材中心必须有露头像的圆形区域')

    # 画布边长(源尺度) = 内孔直径 / 契约比例;超出画布的装饰会被裁掉(打印提醒)。
    canvas = (hole_r * 2) / HOLE_RATIO
    ys, xs = np.where(solid)
    ext = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2).max()
    if ext > canvas / 2 + 1:
        print(f'⚠ 装饰最远处 {ext:.0f}px 超出契约画布半宽 {canvas / 2:.0f}px,超出部分将被裁掉')

    out = Image.new('RGBA', (int(round(canvas)),) * 2, (0, 0, 0, 0))
    out.alpha_composite(im, (int(round(canvas / 2 - cx)), int(round(canvas / 2 - cy))))
    out.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS).save(dst_path)
    print(f'✓ {dst_path}: 内圆心 ({cx:.0f},{cy:.0f}) 直径 {hole_r * 2:.0f}px → 契约 {HOLE_RATIO:.4%},输出 {OUT_SIZE}px')


if __name__ == '__main__':
    main(sys.argv)
