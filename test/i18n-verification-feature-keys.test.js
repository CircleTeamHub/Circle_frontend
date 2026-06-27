const test = require('node:test');
const assert = require('node:assert/strict');

// Regression guard for the circle-invitation / verification feature.
//
// Several screens reference these keys via t(key, { defaultValue: '中文…' }).
// i18next silently falls back to the Chinese defaultValue when a key is absent
// from en.json, so an English user would see Chinese text with no error. This
// test pins the feature's keys into BOTH locales so that regression is caught
// in CI instead of in production.
//
// Scope is intentionally limited to this feature's keys — the repo has a known
// pre-existing backlog of defaultValue-only keys in unrelated namespaces
// (notes/plaza/moment/search) that is out of scope here.
const FEATURE_KEYS = [
  'invitation.cardTitle',
  'invitation.cardCircle',
  'invitation.cardFooter',
  'invitation.pendingTitle',
  'invitation.noPending',
  'invitation.waitingDesc',
  'invitation.viewerOnly',
  'invitation.settledRejected',
  'invitation.settledApproved',
  'invitation.youApproved',
  'invitation.youRejected',
  'invitation.loadFailed',
  'circle.inviteVerifiers',
  'discover.discoverCircles',
  'discover.searchCirclePlaceholder',
  'discover.noCirclesFound',
  'discover.memberCount',
  'discover.needsApproval',
  'discover.searchCappedNotice',
  'common.clear',
  'common.retryLater',
];

const flatten = (obj, prefix = '') => {
  const out = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path));
    } else {
      out[path] = value;
    }
  }
  return out;
};

for (const lng of ['en', 'zh']) {
  test(`${lng}.json defines every verification-feature i18n key`, () => {
    const flat = flatten(require(`../src/i18n/locales/${lng}.json`));
    const missing = FEATURE_KEYS.filter(
      (k) => flat[k] === undefined || flat[k] === '',
    );
    assert.deepEqual(
      missing,
      [],
      `${lng}.json is missing keys (would fall back to defaultValue): ${missing.join(', ')}`,
    );
  });
}

test('every t(...defaultValue) reference for this feature exists in en.json', () => {
  // Catches a NEW screen that adds a verification/discover-circle key with only
  // a defaultValue but forgets to register it. Guards exactly the files this
  // feature owns, so it never trips over unrelated pre-existing debt.
  const fs = require('node:fs');
  const path = require('node:path');
  const FILES = [
    'src/features/chat/components/chat-bubble.tsx',
    'src/features/discover/screens/VerificationRequestScreen.tsx',
    'src/features/discover/screens/PendingVerificationsScreen.tsx',
    'src/features/discover/screens/DiscoverCirclesScreen.tsx',
  ];
  const flat = flatten(require('../src/i18n/locales/en.json'));
  const missing = [];
  for (const rel of FILES) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    // Match t('ns.key', { ... defaultValue ... }) including multi-line option objects.
    const re = /t\(\s*'((?:invitation|circle|discover|common)\.[a-zA-Z0-9_.]+)'\s*,\s*\{[^}]*defaultValue/gs;
    for (const m of src.matchAll(re)) {
      if (flat[m[1]] === undefined) missing.push(`${m[1]} (${rel})`);
    }
  }
  assert.deepEqual(missing, [], `defaultValue-only keys missing from en.json: ${missing.join(', ')}`);
});
