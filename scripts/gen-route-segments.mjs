// 从 app/ 的路由文件派生静态路径段白名单，输出 JSON 到 stdout。
// 用法: node scripts/gen-route-segments.mjs > /tmp/segments.json
// 白名单本身维护在 src/observability/route-segments.ts；漂移由
// test/sentry-route-segments.test.js 钉住。
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APP = process.argv[2] ?? 'app';
function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const segments = new Set();
for (const file of walk(APP)) {
  if (!/\.(tsx|ts|jsx|js)$/.test(file)) continue;
  const rel = relative(APP, file).replace(/\.(tsx|ts|jsx|js)$/, '');
  for (const seg of rel.split(sep)) {
    // _layout 不是 URL 段；index 代表父路径本身；[param] 单独处理。
    // + 前缀是 expo-router 特殊文件(+html/+not-found),不是 URL 段。
    if (seg === '_layout' || seg === 'index' || seg.startsWith('[') || seg.startsWith('+')) continue;
    segments.add(seg);
  }
}
console.log(JSON.stringify([...segments].sort(), null, 2));
