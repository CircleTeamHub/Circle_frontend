const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const helperPath = path.join(
  process.cwd(),
  'src/stores/auth-session-identity.ts',
);

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function loadIdentityHelper() {
  assert.ok(
    fs.existsSync(helperPath),
    'purchase flows need a shared auth-session identity fence',
  );
  const transpiled = ts.transpileModule(fs.readFileSync(helperPath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: helperPath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: helperPath });
  return context.module.exports;
}

test('auth-session identity rejects logout and account-switch completions', () => {
  const identity = loadIdentityHelper();
  const owner = identity.captureAuthSessionIdentity({
    sessionEpoch: 4,
    user: { id: 'user-a' },
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(owner)),
    { sessionEpoch: 4, userId: 'user-a' },
  );
  assert.equal(
    identity.isAuthSessionIdentityCurrent(owner, {
      sessionEpoch: 4,
      user: { id: 'user-a' },
    }),
    true,
  );
  assert.equal(
    identity.isAuthSessionIdentityCurrent(owner, {
      sessionEpoch: 5,
      user: { id: 'user-b' },
    }),
    false,
  );
  assert.equal(
    identity.isAuthSessionIdentityCurrent(owner, {
      sessionEpoch: 5,
      user: null,
    }),
    false,
  );
});

test('both points-purchase screens fence deferred completions to their owner session', () => {
  const fancy = read(
    'src/features/profile/screens/FancyNumberScreen.tsx',
  );
  const expansion = read(
    'src/features/profile/screens/GroupExpansionScreen.tsx',
  );

  for (const source of [fancy, expansion]) {
    assert.match(source, /captureAuthSessionIdentity/);
    assert.match(source, /isAuthSessionIdentityCurrent/);
    assert.match(
      source,
      /isAuthSessionIdentityCurrent\([\s\S]*?useAuthStore\.getState\(\)/,
    );
  }
});

test('fancy-number refresh updates the guarded known-account snapshot', () => {
  const fancy = read(
    'src/features/profile/screens/FancyNumberScreen.tsx',
  );

  assert.match(fancy, /useKnownAccountsStore/);
  assert.match(
    fancy,
    /latest\.setUser\(refreshed\)[\s\S]*?upsertAccount\(\{[\s\S]*?user:\s*refreshed/,
  );
});

test('both points-purchase screens preserve a newer realtime wallet balance', () => {
  const fancy = read(
    'src/features/profile/screens/FancyNumberScreen.tsx',
  );
  const expansion = read(
    'src/features/profile/screens/GroupExpansionScreen.tsx',
  );

  for (const source of [fancy, expansion]) {
    assert.match(source, /\.version/);
    assert.match(source, /setRealtimeBalanceIfVersion/);
  }
});
