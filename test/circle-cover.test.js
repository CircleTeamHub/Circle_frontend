const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('circle cover: type, API, and upload hook are wired', () => {
  const types = read('src/types/index.ts');
  assert.match(types, /cover: string \| null;/);

  const api = read('src/services/api/circles.ts');
  assert.match(api, /export async function setCircleCover/);
  assert.match(api, /\/circle\/\$\{id\}\/cover/);
  // normalizeCircle resolves the cover media url like avatarUrl
  assert.match(api, /cover: circle\.cover \? normalizeMediaUrl/);

  const hook = read(
    'src/features/discover/hooks/use-change-circle-cover.ts',
  );
  assert.match(hook, /setCircleCover\(circleId, fileUrl\)/);
  assert.match(hook, /folder: 'covers'/);
});

test('CircleDetailScreen renders a cover banner editable by the owner', () => {
  const src = read(
    'src/features/discover/screens/CircleDetailScreen.tsx',
  );
  assert.match(src, /useChangeCircleCover/);
  assert.match(src, /s\.coverWrap/);
  assert.match(src, /circle\.cover \?/);
  assert.match(src, /const isOwner = circle\?\.myRole === 'OWNER'/);
  assert.match(src, /isOwner \? changeCircleCover : undefined/);
});
