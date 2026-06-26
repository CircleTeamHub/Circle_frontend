const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('Contacts adds a circles entry below groups, routing to circle management', () => {
  const src = read('src/features/contacts/screens/ContactsScreen.tsx');
  // circles entry sits between groups and tags in the quick-action list
  assert.match(src, /id: 'groups'[\s\S]*id: 'circles'[\s\S]*id: 'tags'/);
  // and routes to the contacts circles page
  assert.match(src, /id === 'circles'[\s\S]*\/\(tabs\)\/contacts\/circles/);
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
