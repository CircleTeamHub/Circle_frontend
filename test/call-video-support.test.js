const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// FE#119：视频通话开放 —— LiveKitRoom 按 callType 开视频、相机开关、
// 视频瓦片渲染、两个呼叫入口的语音/视频选择器、五语言词条。

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('GroupCallScreen publishes video for VIDEO calls only', () => {
  const source = read('src/features/call/screens/GroupCallScreen.tsx');

  assert.match(
    source,
    /video=\{activeCall\.callType === 'VIDEO'\}/,
    'LiveKitRoom 的 video 必须由 callType 驱动',
  );
  assert.doesNotMatch(source, /video=\{false\}/, '写死的音频-only 已移除');
});

test('GroupCallScreen renders camera toggle and video tiles', () => {
  const source = read('src/features/call/screens/GroupCallScreen.tsx');

  assert.match(source, /setCameraEnabled\(!isCameraEnabled\)/);
  assert.match(source, /videocam/, '需要 videocam/videocam-off 图标开关');
  assert.match(source, /useTracks\(\['camera'\]\)/);
  assert.match(source, /<VideoTrack/);
  assert.match(
    source,
    /trackRef\.publication\?\.isMuted/,
    '关摄像头的参与者必须回退到头像瓦片',
  );
  // 音频通话不显示相机开关
  assert.match(source, /\{isVideoCall \? \(/);
});

test('both call entry points offer a voice/video chooser', () => {
  for (const relPath of [
    'src/features/chat/screens/ChatDetailScreen.tsx',
    'src/features/user/screens/UserProfileScreen.tsx',
  ]) {
    const source = read(relPath);
    assert.match(source, /startCallWithType\('AUDIO'\)/, relPath);
    assert.match(source, /startCallWithType\('VIDEO'\)/, relPath);
    assert.match(source, /call\.chooseType/, relPath);
    assert.doesNotMatch(
      source,
      /callType: 'AUDIO'/,
      `${relPath} 不允许再写死 AUDIO`,
    );
  }
});

test('call type chooser copy exists in all five locales', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    const call = dict.call ?? {};
    for (const key of [
      'videoCallTitle',
      'chooseType',
      'typeVoice',
      'typeVideo',
    ]) {
      assert.ok(
        typeof call[key] === 'string' && call[key].length > 0,
        `${locale}.json call.${key}`,
      );
    }
    assert.ok(
      typeof call.livekit?.connectedVideo === 'string' &&
        call.livekit.connectedVideo.length > 0,
      `${locale}.json call.livekit.connectedVideo`,
    );
  }
});
