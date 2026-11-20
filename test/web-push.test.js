const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'public');
const locales = path.join(__dirname, '..', 'src', 'i18n', 'locales');

async function lockScreenAlert(language) {
  const handlers = {};
  let shown;
  const self = {
    navigator: { language },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    registration: { showNotification: async (title, options) => { shown = [title, options.body]; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), { self, URL });
  let work;
  handlers.push({ waitUntil: (promise) => { work = promise; } });
  await work;
  return shown;
}

test('the shortcut starts at the authentication-aware root with usable icons', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const png = fs.readFileSync(path.join(root, icon.src));
    assert.equal(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), icon.sizes);
  }
});

test('the worker shows a generic lock-screen alert and focuses the existing WindNote window', async () => {
  const handlers = {};
  const calls = [];
  const self = {
    navigator: { language: 'zh-CN' },
    location: { origin: 'https://app.example.test' },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    registration: { showNotification: async (title, options) => { calls.push([title, options.body]); } },
    clients: {
      matchAll: async () => [{ url: 'https://app.example.test/messages', focus: async () => { calls.push('focus'); } }],
      openWindow: async (url) => { calls.push(url); },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), { self, URL });
  let work;
  const waitUntil = (promise) => { work = promise; };
  handlers.push({ waitUntil, data: { json: () => ({ body: 'private preview' }) } });
  await work;
  handlers.notificationclick({ waitUntil, notification: { close: () => { calls.push('close'); } } });
  await work;
  assert.deepEqual(calls, [['风信', '新消息'], 'close', 'focus']);
  self.clients.matchAll = async () => [];
  handlers.notificationclick({ waitUntil, notification: { close() {} } });
  await work;
  assert.equal(calls.at(-1), '/');
});

test('the lock-screen alert follows the browser language with the app\'s own new-message copy', async () => {
  assert.deepEqual(await lockScreenAlert('en-US'), ['WindNote', 'New message']);
  for (const [language, locale] of [['en-GB', 'en'], ['ja-JP', 'ja'], ['ko-KR', 'ko'], ['es-419', 'es'], ['zh-TW', 'zh']]) {
    const copy = JSON.parse(fs.readFileSync(path.join(locales, `${locale}.json`), 'utf8'));
    assert.equal((await lockScreenAlert(language))[1], copy.chat.snackbarNewMessage, language);
  }
  assert.deepEqual(await lockScreenAlert('fr-FR'), ['风信', '新消息']);
  assert.deepEqual(await lockScreenAlert(undefined), ['风信', '新消息']);
});
