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
    assert.match(source, /choose\('AUDIO'\)/, relPath);
    assert.match(source, /choose\('VIDEO'\)/, relPath);
    assert.match(source, /startCallWithType\(callType\)/, relPath);
    assert.match(source, /call\.chooseType/, relPath);
    assert.doesNotMatch(
      source,
      /callType: 'AUDIO'/,
      `${relPath} 不允许再写死 AUDIO`,
    );
  }
});

test('incoming VIDEO invites are labeled as video before the callee accepts (review P1)', () => {
  const source = read('src/features/call/components/CallInviteHost.tsx');

  assert.match(source, /isVideoInvite = incomingCall\?\.callType === 'VIDEO'/);
  // 图标与文案都按 callType 分支（接听即发布摄像头，必须先如实标示）
  assert.match(source, /isVideoInvite \? 'videocam' : 'call'/);
  assert.match(source, /initiatedBySingleVideo/);
  assert.match(source, /initiatedByVideo/);

  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    for (const key of ['initiatedBySingleVideo', 'initiatedByVideo']) {
      assert.ok(
        typeof dict.call?.invite?.[key] === 'string' &&
          dict.call.invite[key].includes('{{name}}'),
        `${locale}.json call.invite.${key}`,
      );
    }
  }
});

test('video tile rendering is bounded and local-first (review P2)', () => {
  const source = read('src/features/call/screens/GroupCallScreen.tsx');

  assert.match(source, /const MAX_VIDEO_TILES = \d+/);
  assert.match(source, /map\.size >= MAX_VIDEO_TILES/);
  // 本地画面优先占位
  assert.match(source, /a\.participant\.identity === localIdentity/);
});

test('call chooser cannot be stacked by rapid taps (review P2)', () => {
  for (const relPath of [
    'src/features/chat/screens/ChatDetailScreen.tsx',
    'src/features/user/screens/UserProfileScreen.tsx',
  ]) {
    const source = read(relPath);
    assert.match(source, /callChooserOpenRef\.current\) return|callChooserOpenRef\.current\)\n      return/, relPath);
    assert.match(source, /callChooserOpenRef\.current = true/, relPath);
    assert.match(source, /onDismiss: dismiss/, relPath);
  }
});

test('camera permission copy discloses video calls (review P2)', () => {
  const appConfig = JSON.parse(read('app.json'));
  const camera = appConfig.expo.ios.infoPlist.NSCameraUsageDescription;
  assert.ok(
    camera.includes('视频通话'),
    'NSCameraUsageDescription 必须披露视频通话用途',
  );
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
