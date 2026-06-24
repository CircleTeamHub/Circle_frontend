const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('change-cover i18n keys exist in both locales', () => {
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  assert.ok(zh.moment.changeCover);
  assert.ok(en.moment.changeCover);
  assert.ok(zh.moment.coverUpdateFailed);
  assert.ok(en.moment.coverUpdateFailed);
});
