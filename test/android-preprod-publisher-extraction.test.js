const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('preproduction workflow keeps the publisher in a checked shell script', () => {
  const workflow = read('.github/workflows/android-preprod-build.yml');

  assert.match(
    workflow,
    /run: bash "\$GITHUB_WORKSPACE\/\.github\/scripts\/publish-android-preprod\.sh"/,
  );
  assert.doesNotMatch(workflow, /aws s3api (?:put|copy|get|head|delete)-object/);

  const syntax = spawnSync(
    'bash',
    [
      '-n',
      '.github/scripts/publish-android-preprod.sh',
      '.github/scripts/rollback-android-preprod.sh',
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
});
