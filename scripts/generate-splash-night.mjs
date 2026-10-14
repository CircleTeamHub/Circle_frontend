#!/usr/bin/env node
// 生成「紫色夜空」开屏图（渐变 + 星星），原生启动图与 JS 开屏共用同一份画面，
// 系统启动屏 → JS 动画之间不再跳色。布局见 assets/splash/night-layout.json。
//
//   node scripts/generate-splash-night.mjs
//
// 产物：
//   assets/images/splash-night-bg.png  —— 只有夜空（JS 开屏底图，图标由 JS 画以便旋转）
//   assets/images/splash-night.png     —— 夜空 + 居中图标（iOS 原生启动图，cover 铺满）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const layout = JSON.parse(
  fs.readFileSync(path.join(root, 'assets/splash/night-layout.json'), 'utf8'),
);
const { width: W, height: H } = layout;

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const stops = layout.gradient.map(hex);

// 与 GradientCover 同向：左下(0) → 右上(1)，中段即 baseColor。
function gradientAt(x, y) {
  const t = (x / W + (1 - y / H)) / 2;
  const seg = t < 0.5 ? 0 : 1;
  const u = seg === 0 ? t / 0.5 : (t - 0.5) / 0.5;
  const [a, b] = [stops[seg], stops[seg + 1]];
  return a.map((c, k) => c + (b[k] - c) * u);
}

const png = new PNG({ width: W, height: H });
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const [r, g, b] = gradientAt(x, y);
    const i = (y * W + x) * 4;
    png.data[i] = Math.round(r);
    png.data[i + 1] = Math.round(g);
    png.data[i + 2] = Math.round(b);
    png.data[i + 3] = 255;
  }
}

function blend(x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= W || y >= H || alpha <= 0) return;
  const i = (y * W + x) * 4;
  for (let k = 0; k < 3; k += 1) {
    png.data[i + k] = Math.round(png.data[i + k] * (1 - alpha) + rgb[k] * alpha);
  }
}

const white = [255, 255, 255];
const lilac = hex('#E9DDFF');
const base = layout.starBaseAlpha;

// 圆点星：半径边缘 1px 抗锯齿。
for (const [cx, cy, d] of layout.dots) {
  const r = d / 2;
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x += 1) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      blend(x, y, white, base * Math.max(0, Math.min(1, r + 0.5 - dist)));
    }
  }
}

// 四角闪光：星形线 |x|^0.5 + |y|^0.5 <= r^0.5，超采样抗锯齿。
for (const [left, top, size] of layout.sparkles) {
  const r = size / 2;
  const cx = left + r;
  const cy = top + r;
  for (let y = Math.floor(top); y <= Math.ceil(top + size); y += 1) {
    for (let x = Math.floor(left); x <= Math.ceil(left + size); x += 1) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const dx = Math.abs(x + (sx + 0.5) / 4 - cx);
          const dy = Math.abs(y + (sy + 0.5) / 4 - cy);
          if (Math.sqrt(dx) + Math.sqrt(dy) <= Math.sqrt(r)) hit += 1;
        }
      }
      blend(x, y, lilac, base * (hit / 16));
    }
  }
}

fs.writeFileSync(path.join(root, 'assets/images/splash-night-bg.png'), PNG.sync.write(png));

// 图标取自透明底的 splash-tagline.png（1254² 画布，图标居中、宽 iconWidth），整块居中叠上去。
const icon = PNG.sync.read(fs.readFileSync(path.join(root, 'assets/images/splash-tagline.png')));
const ox = Math.round((W - icon.width) / 2);
const oy = Math.round((H - icon.height) / 2);
for (let y = 0; y < icon.height; y += 1) {
  for (let x = 0; x < icon.width; x += 1) {
    const j = (y * icon.width + x) * 4;
    const a = icon.data[j + 3] / 255;
    if (a > 0) blend(x + ox, y + oy, [icon.data[j], icon.data[j + 1], icon.data[j + 2]], a);
  }
}
fs.writeFileSync(path.join(root, 'assets/images/splash-night.png'), PNG.sync.write(png));
console.log('wrote splash-night-bg.png / splash-night.png');
