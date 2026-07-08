const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const openIMBridgePath = path.join(
  process.cwd(),
  'node_modules/@openim/rn-client-sdk/ios/OpenImSdkRn.m',
);
const patchScriptPath = path.join(
  process.cwd(),
  'scripts/patch-openim-native-events.mjs',
);

function extractBetween(src, start, end) {
  const startIndex = src.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = src.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return src.slice(startIndex, endIndex);
}

function applyOpenIMNativeEventPatch() {
  execFileSync(process.execPath, [patchScriptPath, '--strict'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('OpenIM iOS bridge guards native events before sending them to React Native', () => {
  applyOpenIMNativeEventPatch();

  const src = fs.readFileSync(openIMBridgePath, 'utf8');
  const supportedStart = src.indexOf('supportedEvents');
  const supportedEnd = src.indexOf('startObserving', supportedStart);
  const supportedEvents = src.slice(supportedStart, supportedEnd);
  const pushEvent = extractBetween(
    src,
    '- (void)pushEvent:(NSString *)eventName data:(id)data {',
    '- (NSDictionary *)parseJsonStr2Dict:',
  );
  const supportedOpenIMEventsMethods =
    src.match(/- \(NSSet<NSString \*> \*\)supportedOpenIMEvents/g) ?? [];

  assert.match(supportedEvents, /@"onSyncServerFailed"/);
  assert.match(supportedEvents, /@"onSyncServerFinish"/);
  assert.match(supportedEvents, /@"onSyncServerStart"/);
  assert.match(supportedEvents, /@"onUserCommandAdd"/);
  assert.match(supportedEvents, /@"onUserCommandDelete"/);
  assert.match(supportedEvents, /@"onUserCommandUpdate"/);
  assert.doesNotMatch(src, /NSJSONReadingMutableContainers/);
  assert.match(src, /RCTOpenIMSafeEventBody/);
  assert.equal(supportedOpenIMEventsMethods.length, 1);
  assert.match(pushEvent, /isKindOfClass:\[NSString class\]/);
  assert.match(pushEvent, /supportedOpenIMEvents/);
  assert.match(pushEvent, /if \(!hasListeners\)/);
  assert.match(pushEvent, /dispatch_get_main_queue\(\)/);
  assert.match(pushEvent, /@try/);
  assert.match(pushEvent, /@catch \(NSException \*exception\)/);
  assert.match(src, /onSyncServerFailed:[\s\S]*pushEvent:@"onSyncServerFailed"/);
});

test('OpenIM native event patch script is repeatable and preserves the hardening', () => {
  const src = fs.readFileSync(patchScriptPath, 'utf8');

  assert.match(src, /RCTOpenIMSafeEventBody/);
  assert.match(src, /supportedOpenIMEvents/);
  assert.match(src, /onUserCommandAdd/);
  assert.match(src, /NSJSONReadingFragmentsAllowed/);
  assert.match(src, /@try/);
  assert.match(src, /@catch \(NSException \*exception\)/);
});
