const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 推送来电的跨仓契约：后端（circle_be src/call/call-push.service.ts）发什么，原生层
// （modules/call-push 的 Swift / Kotlin）就按同样的字段名解析。任何一侧改名，另一侧的
// 单测都不会报警 —— 电话只是安静地不响了。CI 会检出同名后端分支（见 ci.yml）。
const BACKEND_ROOT =
  process.env.CIRCLE_BE_PATH ?? path.join(process.cwd(), '..', 'circle_be');
const BACKEND_CALL_PUSH = path.join(BACKEND_ROOT, 'src/call/call-push.service.ts');
const hasBackend = fs.existsSync(BACKEND_CALL_PUSH);
const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test(
  'both sides speak the same call push protocol version',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const backend = fs.readFileSync(BACKEND_CALL_PUSH, 'utf8');
    const backendVersion = backend.match(/export const CALL_PUSH_VERSION = (\d+);/)?.[1];
    const frontendVersion = read('src/features/call/push/call-push-native.ts').match(
      /export const CALL_PUSH_VERSION = (\d+);/,
    )?.[1];

    assert.ok(backendVersion);
    assert.equal(frontendVersion, backendVersion);
    // 原生层只认 v === "1" 的载荷；版本升了要一起改原生解析。
    assert.match(read('modules/call-push/ios/CallPushSupport.swift'), new RegExp(`call\\["v"\\] as\\? String == "${backendVersion}"`));
    assert.match(
      read('modules/call-push/android/src/main/java/expo/modules/callpush/CallPushInvite.kt'),
      new RegExp(`optString\\("v"\\) == "${backendVersion}"`),
    );
  },
);

test(
  'the native layers parse every invite field the backend sends',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const backend = fs.readFileSync(BACKEND_CALL_PUSH, 'utf8');
    const swift = read('modules/call-push/ios/CallPushSupport.swift');
    const kotlin = read(
      'modules/call-push/android/src/main/java/expo/modules/callpush/CallPushInvite.kt',
    );
    for (const field of ['callId', 'callType', 'sessionType', 'callerName', 'groupName', 'expiresAt', 'declineToken']) {
      assert.match(backend, new RegExp(`\\b${field}\\b`), `backend sends ${field}`);
      assert.match(swift, new RegExp(`call\\["${field}"\\]`), `iOS parses ${field}`);
      assert.match(kotlin, new RegExp(`optString\\("${field}"\\)`), `Android parses ${field}`);
    }
    // VoIP 推送的载荷挂在 call 键下（iOS 读 dictionaryPayload["call"]）。
    assert.match(backend, /payload: \{ call: payloadFor\(target\.userID\) \}/);
    assert.match(read('modules/call-push/ios/CallPushCenter.swift'), /dictionaryPayload\["call"\]/);
  },
);

test(
  'the notification-mode ringtone the backend names is the one the app bundles',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const backend = fs.readFileSync(BACKEND_CALL_PUSH, 'utf8');
    const sound = backend.match(/export const CALL_RING_SOUND = '([^']+)';/)?.[1];

    assert.equal(sound, 'call_ring.caf');
    assert.ok(fs.existsSync(path.join(process.cwd(), 'assets/sounds', sound)));
    assert.match(read('app.config.js'), new RegExp(`\\./assets/sounds/${sound.replace('.', '\\.')}`));
    // 撤销用同一个 collapse id 覆盖来电通知；iOS 原生层按这个 id 收掉通知。
    assert.match(backend, /collapseId: `call:\$\{invite\.callId\}`/);
    assert.match(read('modules/call-push/ios/CallPushNotificationCenter.swift'), /"call:\\\(callId\)"/);
  },
);
