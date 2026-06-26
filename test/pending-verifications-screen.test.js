const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const SCREEN = 'src/features/discover/screens/PendingVerificationsScreen.tsx';
const ROUTE = 'app/(tabs)/discover/verifications.tsx';
const DISCOVER = 'src/features/discover/screens/DiscoverScreen.tsx';

test('PendingVerificationsScreen lists the current user pending verifications', () => {
  const src = read(SCREEN);
  assert.match(src, /fetchMyPendingVerifications/);
  // shows applicant + circle + approved/required progress
  assert.match(src, /item\.applicant\.nickname/);
  assert.match(src, /item\.approvedCount\}\/\{item\.requiredCount/);
});

test('PendingVerificationsScreen routes into the respond screen', () => {
  const src = read(SCREEN);
  assert.match(src, /pathname: '\/\(tabs\)\/discover\/verification\/\[id\]'/);
  assert.match(src, /params: \{ id: item\.id \}/);
});

test('verifications route re-exports the screen', () => {
  const src = read(ROUTE);
  assert.match(src, /PendingVerificationsScreen/);
});

test('Discover header exposes a pending-verifications entry', () => {
  const src = read(DISCOVER);
  assert.match(src, /handlePendingVerificationsPress/);
  assert.match(src, /["'`]\/\(tabs\)\/discover\/verifications["'`]/);
  assert.match(src, /name="shield-checkmark-outline"/);
});
