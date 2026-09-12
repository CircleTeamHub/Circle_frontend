const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('circle management is no longer duplicated in Contacts', () => {
  const src = read('src/features/contacts/screens/ContactsScreen.tsx');
  assert.doesNotMatch(src, /id: 'circles'/);
  assert.doesNotMatch(src, /contacts\/circles/);

  const plaza = read('src/features/discover/screens/CirclePlazaScreen.tsx');
  assert.match(plaza, /handleOpenCircleManagement/);
  assert.match(plaza, /\/\(tabs\)\/discover\/management/);
});

test('circles route renders MyCirclesScreen wrapping MyCirclesPanel', () => {
  const route = read('app/(tabs)/contacts/circles.tsx');
  assert.match(route, /MyCirclesScreen/);

  const screen = read('src/features/discover/screens/MyCirclesScreen.tsx');
  assert.match(screen, /MyCirclesPanel/);
});

test('circles label is localized in zh + en', () => {
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  assert.equal(zh.contacts.circles, '圈子');
  assert.equal(en.contacts.circles, 'Circles');
});
