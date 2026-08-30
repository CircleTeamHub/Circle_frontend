const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('preproduction publisher extraction preserves the reviewed inline implementation', () => {
  const workflow = read('.github/workflows/android-preprod-build.yml');
  const script = read('.github/scripts/publish-android-preprod.sh');
  const legacyInlinePublisherSha256 =
    'e1cc494cd785ce225a25b55bb8463facbf8f64956eb7777e2484a784e0a35b2f';

  assert.match(
    workflow,
    /run: "\$GITHUB_WORKSPACE\/\.github\/scripts\/publish-android-preprod\.sh"/,
  );
  assert.doesNotMatch(workflow, /aws s3api (?:put|copy|get|head|delete)-object/);
  assert.equal(
    crypto.createHash('sha256').update(script).digest('hex'),
    legacyInlinePublisherSha256,
  );

  const syntax = spawnSync(
    'bash',
    ['-n', '.github/scripts/publish-android-preprod.sh'],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
});
