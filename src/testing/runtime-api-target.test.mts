import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRuntimeApiTargetId } from './runtime-api-target.ts';

test('runtime API target ids are canonical and regex-safe', () => {
  assert.equal(
    buildRuntimeApiTargetId('https://E2E-API.windnote.test/api/v1'),
    'windnote_runtime_api_origin_00680074007400700073003a002f002f006500320065002d006100700069002e00770069006e0064006e006f00740065002e0074006500730074',
  );
  assert.match(buildRuntimeApiTargetId('https://e2e-api.windnote.test'), /^[a-z0-9_]+$/);
});
