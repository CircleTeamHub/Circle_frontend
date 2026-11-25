const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('only production Web opts into asynchronous routes', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8')).expo;
  const router = config.plugins.find(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-router');
  assert.deepEqual(router[1]?.asyncRoutes, { web: 'production', default: false });
});

test('prefetch metadata belongs to its HTML build and contains only deferred hashed JavaScript, with the editor first', async () => {
  const { prepareWebPrefetch } = await import('../scripts/prepare-web-prefetch.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'windnote-web-prefetch-'));
  try {
    const assets = path.join(directory, '_expo/static/js/web');
    fs.mkdirSync(assets, { recursive: true });
    const entry = `index-${'a'.repeat(32)}.js`;
    const editor = `NoteBlockEditor.dom-${'b'.repeat(32)}.js`;
    const page = `wallet-${'c'.repeat(32)}.js`;
    const notFound = `+not-found-${'d'.repeat(32)}.js`;
    for (const [file, body] of [[entry, 'entry'], [editor, 'editor'], [page, 'large page content'], [notFound, 'small'], ['unused.js', 'ignore'], [`${page}.map`, 'ignore']]) {
      fs.writeFileSync(path.join(assets, file), body);
    }
    const index = path.join(directory, 'index.html');
    fs.writeFileSync(index, `<html><head><meta charset="utf-8"></head><body><script src="/_expo/static/js/web/${entry}" defer></script></body></html>`);
    prepareWebPrefetch(directory);
    const html = fs.readFileSync(index, 'utf8');
    const metadata = /<script id="windnote-web-prefetch-assets" type="application\/json">([^<]*)<\/script>/.exec(html);
    assert.ok(metadata);
    assert.deepEqual(JSON.parse(metadata[1]), [`/_expo/static/js/web/${editor}`, `/_expo/static/js/web/${page}`, `/_expo/static/js/web/${notFound}`]);
    assert.ok(html.indexOf('windnote-web-prefetch-assets') < html.indexOf('</head>'));
    prepareWebPrefetch(directory);
    assert.equal(fs.readFileSync(index, 'utf8'), html);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
