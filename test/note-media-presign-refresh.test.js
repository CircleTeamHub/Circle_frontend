const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// 笔记媒体改走 presign-on-read 后，客户端手里的 URL 是有 TTL 的短时签名。过期后图片会
// 403 静默变空白，且不会自己恢复 —— 这几条测试钉住两条恢复路径（focus 重拉 + 失败自愈）。

test('note detail reloads on focus so expired presigned media urls refresh', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');

  // 只在 mount 拉一次的话，从编辑页 / 别的 tab 回来时手里还是旧签名。
  assert.match(src, /useFocusEffect\(loadNote\)/);
  assert.doesNotMatch(src, /useEffect\(\(\)\s*=>\s*loadNote\(\)/);
});

test('note detail self-heals a 403 image by refetching, throttled against loops', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');

  assert.match(src, /const handleMediaError = useCallback/);
  assert.match(src, /loadNote\(\)/);
  // 节流：图片本身坏掉时重拉救不了，不能让 onError → refetch → onError 打转。
  assert.match(src, /lastMediaRetryRef/);
  assert.match(src, /30_000/);
  // 正文 / 媒体 / 展示三个区块都要接上，否则各自留下空图。
  const wirings = src.match(/onMediaError=\{handleMediaError\}/g) ?? [];
  assert.ok(
    wirings.length >= 3,
    `expected all 3 NoteBlockRenderer usages wired, got ${wirings.length}`,
  );
});

test('note block renderer forwards image load failures to its caller', () => {
  const src = read('src/features/notes/components/NoteBlockRenderer.tsx');

  assert.match(src, /onMediaError\?:\s*\(\)\s*=>\s*void/);
  assert.match(src, /onError=\{onMediaError\}/);
});

test('note card reports cover load failures so TTL can be observed', () => {
  const src = read('src/features/notes/components/NoteCard.tsx');

  // 列表本身有 focus / 下拉刷新会自愈，这里只需要可观测性。
  assert.match(src, /logClientDiagnostic\('note_cover_load_failed'/);
});
