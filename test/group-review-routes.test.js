const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('application management and logs remain in every originating tab stack', () => {
  for (const scope of ['messages', 'contacts', 'discover', 'explore', 'profile']) {
    const route = fs.readFileSync(path.join(__dirname, '..', 'app', '(tabs)', scope, 'group-review.tsx'), 'utf8');
    assert.match(route, /export \{ default \} from '@\/features\/groups\/GroupReviewScreen'/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'app', '(tabs)', scope, 'group-log.tsx')));
    const abnormal = fs.readFileSync(path.join(__dirname, '..', 'app', '(tabs)', scope, 'group-abnormal-members.tsx'), 'utf8');
    assert.match(abnormal, /export \{ default \} from '@\/features\/chat\/screens\/GroupAbnormalMembersScreen'/);
  }
  const info = fs.readFileSync(path.join(__dirname, '../src/features/chat/screens/ChatInfoScreen.tsx'), 'utf8');
  assert.doesNotMatch(info, /handleOpenGroupLog|getGroupLogHref/);
});
