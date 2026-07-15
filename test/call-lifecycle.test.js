const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: { '@/*': ['src/*'] },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) =>
      specifier in stubs ? stubs[specifier] : require(specifier),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const SAMPLE_INVITE = {
  callId: 'c1',
  conversationID: 'g1',
  sessionType: 'group',
  callType: 'AUDIO',
  initiator: { id: 'u1', nickname: 'A', avatarUrl: null },
  invitees: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T00:00:45.000Z',
};

// C-08 ②: logout must clear an in-flight incoming call / active call so account
// A's ring popup can't bleed into account B.
test('use-call-store registers a logout handler that clears call state (C-08)', () => {
  let logoutHandler;
  const { useCallStore } = loadTsModule(
    'src/features/call/store/use-call-store.ts',
    {
      '@/services/auth/session': {
        registerLogoutHandler: (handler) => {
          logoutHandler = handler;
          return () => {};
        },
      },
    },
  );

  useCallStore.getState().handleCallInvite(SAMPLE_INVITE);
  assert.ok(useCallStore.getState().incomingCall);
  assert.ok(useCallStore.getState().activeCall);

  assert.equal(typeof logoutHandler, 'function');
  logoutHandler();

  assert.equal(useCallStore.getState().incomingCall, null);
  assert.equal(useCallStore.getState().activeCall, null);
});

// C-08 ③: leaving the call screen (back gesture / router.back / call-ended
// unmount) must disconnect the LiveKit room so the mic/WebRTC session is freed.
test('GroupCallScreen disconnects the LiveKit room on unmount (C-08)', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/features/call/screens/GroupCallScreen.tsx'),
    'utf8',
  );
  assert.match(
    src,
    /useEffect\(\(\)\s*=>\s*\{\s*return\s*\(\)\s*=>\s*\{\s*room\.disconnect\(\)/,
  );
});
