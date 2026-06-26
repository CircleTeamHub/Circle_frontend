const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SRC = 'src/features/discover/screens/CircleDetailScreen.tsx';

test('CircleDetailScreen wires leave-circle to the API', () => {
  const src = read(SRC);
  const store = read('src/features/discover/store/use-circles-store.ts');

  assert.match(src, /leaveCircle,?\s*\n?\s*\}?\s*from '@\/services\/api\/circles'|leaveCircle/);
  assert.match(src, /await leaveCircle\(id\)/);
  assert.match(store, /removeCircle: \(id: string\) => void/);
  assert.match(src, /useCirclesStore\.getState\(\)\.removeCircle\(id\)/);
  assert.match(src, /router\.back\(\)/);
});

test('CircleDetailScreen only lets active non-owner members leave', () => {
  const src = read(SRC);

  assert.match(
    src,
    /canLeaveCircle\s*=[\s\S]*myStatus === 'ACTIVE'[\s\S]*myRole !== 'OWNER'/,
  );
  // Leave button is guarded by canLeaveCircle and routes to the handler.
  assert.match(src, /\{canLeaveCircle \? \(/);
  assert.match(src, /onPress=\{handleLeaveCircle\}/);
});
