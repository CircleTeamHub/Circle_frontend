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
const fancyNumberFencePath = path.join(
  process.cwd(),
  'src/features/profile/fancy-number-operation-fence.ts',
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

function loadFancyNumberFence() {
  const transpiled = ts.transpileModule(
    fs.readFileSync(fancyNumberFencePath, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: fancyNumberFencePath,
    },
  ).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: fancyNumberFencePath });
  return context.module.exports;
}

test('auth-session identity rejects logout and account-switch completions', () => {
  const identity = loadIdentityHelper();
  const owner = identity.captureAuthSessionIdentity({
    sessionEpoch: 4,
    user: { id: 'user-a' },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(owner)), {
    sessionEpoch: 4,
    userId: 'user-a',
  });
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
  const fancy = read('src/features/profile/screens/FancyNumberScreen.tsx');
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
  const fancy = read('src/features/profile/screens/FancyNumberScreen.tsx');

  assert.match(fancy, /useKnownAccountsStore/);
  assert.match(
    fancy,
    /latest\.setUser\(refreshed\)[\s\S]*?upsertAccount\(\{[\s\S]*?user:\s*refreshed/,
  );
});

test('both points-purchase screens preserve a newer realtime wallet balance', () => {
  const fancy = read('src/features/profile/screens/FancyNumberScreen.tsx');
  const expansion = read(
    'src/features/profile/screens/GroupExpansionScreen.tsx',
  );

  for (const source of [fancy, expansion]) {
    assert.match(source, /\.version/);
    assert.match(source, /setRealtimeBalanceIfVersion/);
  }
});

test('fancy-number operation fencing rejects a superseded screen completion', () => {
  const fence = loadFancyNumberFence();
  const older = fence.beginFancyNumberOperation();
  const newer = fence.beginFancyNumberOperation();

  assert.equal(fence.isLatestFancyNumberOperation(older), false);
  assert.equal(fence.isLatestFancyNumberOperation(newer), true);
});

test('fancy-number pagination accepts only pages from the same catalog quote', () => {
  const fence = loadFancyNumberFence();
  const current = {
    items: [],
    nextCursor: 'next',
    unitPrice: 100,
    minMonths: 1,
    maxMonths: 12,
    purchaseMode: 'PAID_MONTHLY',
  };

  assert.equal(
    fence.hasMatchingFancyNumberCatalogQuote(current, {
      ...current,
      items: [{ id: 'fancy-1', value: '888888' }],
    }),
    true,
  );
  assert.equal(
    fence.hasMatchingFancyNumberCatalogQuote(current, {
      ...current,
      unitPrice: 200,
      purchaseMode: 'PERMANENT_FREE',
    }),
    false,
  );
});
