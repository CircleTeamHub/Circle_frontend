const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const install = require('../scripts/web-startup.cjs');
const asset = `index-${'a'.repeat(32)}.js`;
const config = { assets: [asset], build: 'a'.repeat(32), environment: 'production', endpoint: 'https://ingest.sentry.test/api/1/envelope/' };

function browser({ offline = false, storageBlocked = false, fetchHangs = false } = {}) {
  const listeners = new Map();
  const timers = new Map();
  const storage = new Map();
  const requests = [];
  const nodes = new Map();
  let nextTimer = 0;
  const document = {
    hidden: false,
    readyState: 'loading',
    body: { appendChild(node) { nodes.set(node.id, node); } },
    createElement() {
      return { style: {}, children: [], setAttribute() {}, appendChild(node) { this.children.push(node); }, remove() { nodes.delete(this.id); } };
    },
    getElementById(id) { return nodes.get(id); },
    addEventListener(name, fn) { listeners.set(`document:${name}`, fn); },
    removeEventListener(name) { listeners.delete(`document:${name}`); },
  };
  const window = {
    navigator: { userAgent: 'iPhone Safari private-user-agent' },
    location: { href: 'https://app.test/private/person?token=SECRET', reload() {} },
    localStorage: {
      setItem(key, value) { if (storageBlocked) throw Error('blocked'); storage.set(key, value); },
    },
    performance: {
      getEntriesByType() {
        return [{ name: `https://app.test/_expo/static/js/web/${asset}`, duration: 1200, nextHopProtocol: 'h3', encodedBodySize: 3000000 }];
      },
    },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    fetch(url, options) {
      requests.push({ url, options });
      if (fetchHangs) return new Promise(() => {});
      return offline ? Promise.reject(Error('network SECRET')) : Promise.resolve({ ok: true });
    },
  };
  install(window, document, config);
  return { window, document, listeners, timers, storage, requests, nodes,
    timeout() { const timer = [...timers.values()].find(t => t.ms === 60000); assert.ok(timer); timer.fn(); },
  };
}

test('a script failure is captured before the application or Sentry SDK exists, without private data', async () => {
  const b = browser();
  b.listeners.get('error')({ target: { tagName: 'IMG', src: 'https://private.test/SECRET' } });
  b.listeners.get('error')({ target: { tagName: 'SCRIPT', src: 'https://third-party.test/SECRET.js' } });
  assert.equal(b.requests.length, 0);
  b.listeners.get('error')({ target: { tagName: 'SCRIPT', src: `https://app.test/_expo/static/js/web/${asset}?token=SECRET` } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.requests.length, 1);
  const { options } = b.requests[0];
  const event = JSON.parse(options.body.split('\n')[2]);
  assert.equal(event.tags.kind, 'scriptLoadFailed');
  assert.equal(event.extra.startup.asset, asset);
  assert.equal(event.extra.startup.sentryReady, false);
  assert.equal(event.extra.startup.resources[0].protocol, 'h3');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(options.keepalive, true, 'refreshing the failure page must not cancel the small envelope');
  assert.doesNotMatch(options.body, /SECRET|private-user-agent|person|token=|location/);
  assert.ok(b.nodes.has('windnote-startup-diagnostic'));
  assert.equal(JSON.parse([...b.storage.values()][0]).delivery, 'sent');
});

test('a page that never renders produces a startup timeout; a committed page cleans up the watchdog', async () => {
  const stuck = browser();
  stuck.window.__WINDNOTE_WEB_STARTUP__.sentryReady();
  stuck.timeout();
  await new Promise(resolve => setImmediate(resolve));
  const event = JSON.parse(stuck.requests[0].options.body.split('\n')[2]);
  assert.equal(event.tags.kind, 'startupTimeout');
  assert.equal(event.extra.startup.sentryReady, true);

  const healthy = browser();
  healthy.window.__WINDNOTE_WEB_STARTUP__.ready();
  assert.equal(healthy.timers.size, 0);
  assert.equal(healthy.listeners.size, 0);
  assert.equal(healthy.requests.length, 0);
});

test('background tabs do not produce startup timeouts', () => {
  const b = browser();
  b.document.hidden = true;
  b.listeners.get('document:visibilitychange')();
  assert.equal(b.timers.size, 0);
  b.document.hidden = false;
  b.listeners.get('document:visibilitychange')();
  assert.ok([...b.timers.values()].some(timer => timer.ms === 60000));
});

test('a failed telemetry request still leaves a local, visible report and does not cause another report', async () => {
  const b = browser({ offline: true });
  b.listeners.get('error')({ message: 'SECRET', error: Error('SECRET') });
  await new Promise(resolve => setImmediate(resolve));
  const report = JSON.parse([...b.storage.values()][0]);
  assert.equal(report.kind, 'scriptEvaluationFailed');
  assert.equal(report.delivery, 'failed');
  assert.ok(b.nodes.has('windnote-startup-diagnostic'));
  b.listeners.get('unhandledrejection')({ reason: Error('SECRET') });
  assert.equal(b.requests.length, 1);
  assert.doesNotMatch(JSON.stringify(report), /SECRET/);

  const privateMode = browser({ offline: true, storageBlocked: true });
  assert.doesNotThrow(() => privateMode.timeout());
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(privateMode.nodes.has('windnote-startup-diagnostic'));
});

test('a stalled telemetry connection is bounded and retains the local report', () => {
  const b = browser({ fetchHangs: true });
  b.timeout();
  const sendTimer = [...b.timers.values()].find(timer => timer.ms === 8000);
  assert.ok(sendTimer);
  sendTimer.fn();
  assert.equal(JSON.parse([...b.storage.values()][0]).delivery, 'failed');
});

test('an early failure is reported before body exists and its panel appears when parsing advances', async () => {
  const b = browser();
  const body = b.document.body;
  b.document.body = null;
  b.timeout();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.requests.length, 1, 'reporting must not wait for DOM readiness');
  assert.equal(b.nodes.size, 0);
  assert.equal(typeof b.listeners.get('document:readystatechange'), 'function');
  b.document.body = body;
  b.document.readyState = 'interactive';
  b.listeners.get('document:readystatechange')();
  assert.ok(b.nodes.has('windnote-startup-diagnostic'));
  b.window.__WINDNOTE_WEB_STARTUP__.ready();
  assert.equal(b.listeners.size, 0);
});

test('web export installs the standalone probe before any application scripts and does not duplicate it', async () => {
  const { prepareWebStartup } = await import('../scripts/prepare-web-startup.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'windnote-web-startup-'));
  try {
    const index = path.join(dir, 'index.html');
    fs.writeFileSync(index, `<html><head><meta charset="utf-8"><link rel="stylesheet" href="/_expo/static/css/slow.css"></head><body><div id="root"></div><script src="/_expo/static/js/web/${asset}" defer></script></body></html>`);
    prepareWebStartup(dir, { dsn: 'https://public@ingest.sentry.test/1' });
    const output = fs.readFileSync(index, 'utf8');
    assert.ok(output.indexOf('windnote-web-startup') < output.indexOf('<div id="root">'));
    assert.ok(output.indexOf('windnote-web-startup') < output.indexOf('<link rel="stylesheet"'), 'the watchdog must execute before stylesheets can block scripts');
    assert.ok(output.indexOf('<meta charset="utf-8">') < output.indexOf('windnote-web-startup'), 'keep the encoding declaration ahead of the inline probe');
    assert.match(output, /https:\/\/ingest\.sentry\.test\/api\/1\/envelope\//);
    assert.doesNotMatch(output, /require\(|module\.exports|SENTRY_AUTH_TOKEN/);
    const inline = /<script id="windnote-web-startup">([\s\S]*?)<\/script>/.exec(output)[1];
    const b = browser();
    b.window.__WINDNOTE_WEB_STARTUP__.ready();
    vm.runInNewContext(inline, { window: b.window, document: b.document });
    assert.ok([...b.timers.values()].some(timer => timer.ms === 60000), 'the serialized inline script runs independently');
    prepareWebStartup(dir, { dsn: 'https://public@ingest.sentry.test/1' });
    assert.equal(fs.readFileSync(index, 'utf8'), output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
