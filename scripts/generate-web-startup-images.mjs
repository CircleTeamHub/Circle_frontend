// 生成「添加到主屏幕」的 iOS 启动图，并把 <link rel="apple-touch-startup-image"> 写进 public/index.html。
//
// 为什么要有：从桌面图标打开时，页面还没下载到之前 iOS 只能画启动图；没有启动图就是整屏
// 纯色（深色模式下全黑）。启动图按设备像素尺寸精确匹配，所以每种 iPhone 屏幕一张、
// 浅色深色各一张。它和 public/index.html 里的 #boot-splash 长得一样（同底色、同图标、
// 同位置），页面一到就无缝换成带转圈的网页启动画面。
//
// 改了图标、主题底色或启动画面布局后重新运行：node scripts/generate-web-startup-images.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

// CSS 尺寸、倍率、竖屏状态栏高度。主屏幕网页 App 的视口从状态栏下面开始，
// #boot-splash 在视口里居中，启动图要按同一个位置画图标。
export const STARTUP_DEVICES = [
  { width: 375, height: 667, scale: 2, statusBar: 20 }, // iPhone SE 第 2/3 代
  { width: 375, height: 812, scale: 3, statusBar: 50 }, // 12 mini / 13 mini（X、XS、11 Pro 是 44）
  { width: 414, height: 896, scale: 2, statusBar: 48 }, // 11 / XR
  { width: 414, height: 896, scale: 3, statusBar: 44 }, // 11 Pro Max / XS Max
  { width: 390, height: 844, scale: 3, statusBar: 47 }, // 12 / 13 / 14 / 16e
  { width: 428, height: 926, scale: 3, statusBar: 47 }, // 12 Pro Max / 13 Pro Max / 14 Plus
  { width: 393, height: 852, scale: 3, statusBar: 59 }, // 14 Pro / 15 / 15 Pro / 16
  { width: 430, height: 932, scale: 3, statusBar: 59 }, // 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus
  { width: 402, height: 874, scale: 3, statusBar: 62 }, // 16 Pro / 17 / 17 Pro / 18 Pro
  { width: 440, height: 956, scale: 3, statusBar: 62 }, // 16 Pro Max / 17 Pro Max / 18 Pro Max
  { width: 420, height: 912, scale: 3, statusBar: 62 }, // iPhone Air
];

// 与 src/theme/colors.ts 的 lightColors / darkColors.background 一致（有测试守着）。
export const STARTUP_THEMES = { light: '#F8F9FA', dark: '#000000' };

// 与 #boot-splash 一致：图标 96pt、圆角 24pt；图标、24pt 间距、24pt 转圈这一列在视口里居中，
// 所以图标中心在视口正中往上 24pt。
const ICON_SIZE = 96;
const ICON_RADIUS = 24;
const ICON_OFFSET_Y = -24;

export function startupImagePath({ width, height, scale }, theme) {
  return `/startup/iphone-${width}x${height}@${scale}x-${theme}.png`;
}

export function startupImageLinks() {
  return STARTUP_DEVICES.flatMap(device => Object.keys(STARTUP_THEMES).map(theme => {
    const media = `screen and (device-width: ${device.width}px) and (device-height: ${device.height}px) and ` +
      `(-webkit-device-pixel-ratio: ${device.scale}) and (orientation: portrait) and (prefers-color-scheme: ${theme})`;
    return `<link rel="apple-touch-startup-image" media="${media}" href="${startupImagePath(device, theme)}" />`;
  }));
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// 4×4 超采样 + 双线性取样把 512px 图标缩到目标尺寸，同时按圆角裁出抗锯齿的边。
function renderIcon(source, size, radius) {
  const out = new Float32Array(size * size * 4);
  const samples = 4;
  const ratio = source.width / size;
  const read = (x, y, channel) => source.data[(y * source.width + x) * 4 + channel];
  const bilinear = (fx, fy, channel) => {
    const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(fy)));
    const x1 = Math.min(source.width - 1, x0 + 1);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = read(x0, y0, channel) * (1 - tx) + read(x1, y0, channel) * tx;
    const bottom = read(x0, y1, channel) * (1 - tx) + read(x1, y1, channel) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  const insideRoundedSquare = (x, y) => {
    const dx = Math.max(radius - x, 0, x - (size - radius));
    const dy = Math.max(radius - y, 0, y - (size - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const rgb = [0, 0, 0];
      let alpha = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          if (!insideRoundedSquare(px, py)) continue;
          const fx = px * ratio - 0.5;
          const fy = py * ratio - 0.5;
          const a = bilinear(fx, fy, 3) / 255;
          for (let c = 0; c < 3; c += 1) rgb[c] += bilinear(fx, fy, c) * a;
          alpha += a;
        }
      }
      const i = (y * size + x) * 4;
      const coverage = alpha / (samples * samples);
      for (let c = 0; c < 3; c += 1) out[i + c] = alpha > 0 ? rgb[c] / alpha : 0;
      out[i + 3] = coverage;
    }
  }
  return out;
}

export function renderStartupImage(device, background, iconSource) {
  const width = device.width * device.scale;
  const height = device.height * device.scale;
  const size = ICON_SIZE * device.scale;
  const icon = renderIcon(iconSource, size, ICON_RADIUS * device.scale);
  const viewportCenterY = device.statusBar + (device.height - device.statusBar) / 2;
  const left = Math.round((width - size) / 2);
  const top = Math.round((viewportCenterY + ICON_OFFSET_Y) * device.scale - size / 2);
  const bg = hexToRgb(background);
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = bg[0];
    png.data[i * 4 + 1] = bg[1];
    png.data[i * 4 + 2] = bg[2];
    png.data[i * 4 + 3] = 255;
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const from = (y * size + x) * 4;
      const a = icon[from + 3];
      if (a === 0) continue;
      const to = ((top + y) * width + left + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        png.data[to + c] = Math.round(icon[from + c] * a + bg[c] * (1 - a));
      }
    }
  }
  return PNG.sync.write(png, { colorType: 2, deflateLevel: 9 });
}

const START = '<!-- web-startup-images:start -->';
const END = '<!-- web-startup-images:end -->';

export function writeStartupImageLinks(html) {
  const from = html.indexOf(START);
  const to = html.indexOf(END);
  if (from < 0 || to < from) throw new Error(`public/index.html 里找不到 ${START} … ${END}`);
  const indent = '    ';
  const block = [START, ...startupImageLinks(), END].join(`\n${indent}`);
  return html.slice(0, from) + block + html.slice(to + END.length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd();
  const publicDir = join(root, 'public');
  const iconSource = PNG.sync.read(readFileSync(join(publicDir, 'icons/windnote-512.png')));
  mkdirSync(join(publicDir, 'startup'), { recursive: true });
  for (const device of STARTUP_DEVICES) {
    for (const [theme, background] of Object.entries(STARTUP_THEMES)) {
      writeFileSync(join(publicDir, startupImagePath(device, theme)), renderStartupImage(device, background, iconSource));
    }
  }
  const indexPath = join(publicDir, 'index.html');
  writeFileSync(indexPath, writeStartupImageLinks(readFileSync(indexPath, 'utf8')));
  console.log(`wrote ${STARTUP_DEVICES.length * Object.keys(STARTUP_THEMES).length} startup images`);
}
