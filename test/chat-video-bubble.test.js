const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/features/chat/components/bubbles/video-bubble.tsx'),
  'utf8',
);

// 每个 VideoView 背后都是一个原生播放器。把 message.videoUrl 直接交给
// useVideoPlayer 意味着一屏几条视频就同时装载几路解码器（iOS 上到上限后
// 后面的气泡直接黑屏），并且每条都会去拉签名 URL 的首段数据。
// 播放器必须以空源挂载，等用户点了播放再 replaceAsync 装载。
test('video bubble mounts an empty player and loads the source only on play', () => {
  assert.match(source, /useVideoPlayer\(\s*null/);
  assert.doesNotMatch(source, /useVideoPlayer\(\s*message\.videoUrl/);
  assert.match(source, /replaceAsync\(videoUrl\)/);
});

// 签名 URL 过期后读路径会换发一条新的；播放器还钉着旧 URL 的话，
// 用户看到的是一条永远转圈的视频。
test('video bubble falls back to the poster state when the signed url changes', () => {
  assert.match(source, /useEffect\(\(\) => \{\s*setActivated\(false\);\s*\}, \[videoUrl\]\)/);
});

// 气泡文案跟着应用语言走，不能硬编码中文（i18n 五语种齐平测试覆盖键，
// 这里守住调用点本身）。
test('video bubble localizes its poster and unavailable copy', () => {
  assert.match(source, /t\('chat\.detail\.videoUnavailable'/);
  assert.match(source, /t\('chat\.detail\.playVideo'/);
  assert.doesNotMatch(source, />视频不可用</);
});
