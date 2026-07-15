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

// C-08 ②: logout must clear an in-flight incoming call / active call so account
// A's ring popup can't bleed into account B. The teardown side-effect module
// registers a logout handler that calls resetCallState.
test('call-session-teardown registers a logout handler that clears call state (C-08)', () => {
  let logoutHandler;
  let resetCalls = 0;
  loadTsModule('src/features/call/call-session-teardown.ts', {
    '@/services/auth/session': {
      registerLogoutHandler: (handler) => {
        logoutHandler = handler;
        return () => {};
      },
    },
    '@/features/call/store/use-call-store': {
      useCallStore: {
        getState: () => ({
          resetCallState: () => {
            resetCalls += 1;
          },
        }),
      },
    },
  });

  assert.equal(typeof logoutHandler, 'function');
  logoutHandler();
  assert.equal(resetCalls, 1);
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
