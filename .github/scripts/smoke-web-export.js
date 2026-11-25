const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DIST = path.resolve(process.env.WEB_EXPORT_DIR || path.join(process.cwd(), 'dist'));
const MIME = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Chrome 冷启动在共享 runner 上偶尔要十几秒。原来的 10s 预算会把一次慢启动
// 判成失败，红在与改动完全无关的 PR 上。
const CHROME_STARTUP_TIMEOUT_MS = 30_000;
const LOGIN_PASSWORD = '[data-testid="windnote.auth.login.password-input"][type="password"]';

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    ...String(process.env.PATH || '')
      .split(path.delimiter)
      .flatMap((dir) =>
        ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(
          (name) => path.join(dir, name),
        ),
      ),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const executable = candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!executable) throw new Error('Chrome/Chromium executable not found');
  return executable;
}

function resolveAsset(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '');
  const candidates = relative
    ? [relative, `${relative}.html`, path.join(relative, 'index.html')]
    : ['index.html'];
  for (const candidate of candidates) {
    const absolute = path.resolve(DIST, candidate);
    if (!absolute.startsWith(`${DIST}${path.sep}`)) continue;
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute;
  }
  return null;
}

async function startServer() {
  const missing = [];
  const requests = new Map();
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    requests.set(pathname, (requests.get(pathname) || 0) + 1);
    // Production web is a client-only SPA. Extensionless deep links must fall
    // back to index.html; real missing assets still stay 404/fail closed.
    const asset =
      resolveAsset(pathname) ||
      (!path.extname(pathname) ? path.join(DIST, 'index.html') : null);
    if (!asset) {
      missing.push(pathname);
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(asset)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(asset).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    missing,
    requests,
    origin: `http://127.0.0.1:${server.address().port}`,
  };
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.waiters.get(message.method) || [];
      for (const listener of listeners) listener(message.params);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const listeners = this.waiters.get(method) || [];
      const done = (params) => {
        clearTimeout(timer);
        this.waiters.set(
          method,
          (this.waiters.get(method) || []).filter((item) => item !== done),
        );
        resolve(params);
      };
      listeners.push(done);
      this.waiters.set(method, listeners);
      const timer = setTimeout(() => reject(new Error(`Timed out: ${method}`)), timeoutMs);
    });
  }

  on(method, listener) {
    const listeners = this.waiters.get(method) || [];
    listeners.push(listener);
    this.waiters.set(method, listeners);
  }

  close() {
    this.socket.close();
  }
}

async function waitForDevTools(userDataDir, child, readStderr) {
  const activePort = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + CHROME_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // Some hosted runners announce the ready endpoint but never materialize
    // DevToolsActivePort. The stderr URL is Chrome's other authoritative signal.
    const announced = readStderr().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (announced) return Number(announced[1]);
    try {
      const [port] = fs.readFileSync(activePort, 'utf8').trim().split('\n');
      if (Number(port) > 0) return Number(port);
    } catch (error) {
      // Windows can expose the file while Chrome is still writing it.
      if (error.code !== 'ENOENT' && error.code !== 'EBUSY') throw error;
    }
    // 启动失败时 Chrome 会立刻退出；继续空轮询只会把真错误拖成一句超时。
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Chrome exited before DevTools was ready (code=${child.exitCode}, signal=${child.signalCode})\n${readStderr()}`,
      );
    }
    await sleep(100);
  }
  throw new Error(
    `Chrome DevTools did not start within ${CHROME_STARTUP_TIMEOUT_MS}ms\n${readStderr()}`,
  );
}

async function stopProcess(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return;

  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    exited.then(() => true),
    sleep(timeoutMs).then(() => false),
  ]);
  if (stopped || child.exitCode !== null) return;

  child.kill('SIGKILL');
  await exited;
}

async function closeBrowser(cdp, timeoutMs = 5_000) {
  if (!cdp) return;

  try {
    await Promise.race([
      cdp.send('Browser.close').catch(() => undefined),
      sleep(timeoutMs),
    ]);
  } finally {
    cdp.close();
  }
}

function removeUserDataDir(userDataDir) {
  try {
    fs.rmSync(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  } catch (error) {
    if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error;
    process.stderr.write(
      `Warning: Chrome profile cleanup is still busy; the ephemeral runner will remove ${userDataDir}.\n`,
    );
  }
}

async function checkMobileRegistration(cdp, origin) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 320, height: 568, deviceScaleFactor: 2, mobile: true,
  });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: origin + '/register' });
  await loaded;
  const check = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const deadline = Date.now() + 10000;
      while (!document.querySelector('input[type=password]') && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const inputs = Array.from(document.querySelectorAll('input'));
      const password = document.querySelector('input[type=password]');
      const toggle = password?.parentElement?.querySelector('[role=button],button');
      if (!password || !toggle || inputs.length < 3) return 'Registration form missing';
      if (innerWidth !== 320 || document.documentElement.scrollWidth > innerWidth) {
        return 'Registration page exceeds the phone viewport';
      }
      for (const el of [...inputs, toggle]) {
        el.scrollIntoView({block: 'center', behavior: 'instant'});
        const rect = el.getBoundingClientRect();
        if (rect.left < 0 || rect.right > innerWidth || rect.width < 44 || rect.height < 44) {
          return 'Registration control outside its usable bounds: ' + el.tagName;
        }
        if (!el.contains(document.elementFromPoint(rect.left + 3, rect.top + 3))) {
          return 'Registration control cannot be tapped near its edge: ' + el.tagName;
        }
      }
      toggle.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      return password.type === 'text' ? null : 'Password visibility toggle did not respond';
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (check.exceptionDetails || check.result.value !== null) {
    throw new Error(check.exceptionDetails?.exception?.description || check.result.value || 'Mobile registration check failed');
  }
}

// Runs before application code. Preserve real local static loads and keep all
// account data in a synthetic HTTP fixture.
function installLoginFixture() {
  const originalFetch = window.fetch.bind(window);
  const user = {
    id: 'smoke-user', accountId: 'Smoke123', inviteCode: 'Smoke123', nickname: 'Smoke User',
    avatarUrl: null, cover: null, email: 'smoke@example.test', phoneNumber: null,
    wechat: null, qq: null, whatsup: null, persona: null, helloWords: null,
    birthday: null, gender: 'unset', city: null, vipLevel: 0, creditScore: 0,
    fancyNumber: false, role: 'USER', status: 'ACTIVE', lastOnline: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
  const claims = { sub: user.id, sid: 'smoke-session', exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = `fixture.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.fixture`;
  let signedIn = false;
  window.smokeApiCalls = [];
  window.smokeScriptPreloads = [];
  window.smokeScripts = [];
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.matches?.('link[rel="preload"][as="script"][fetchpriority="low"]')) {
          window.smokeScriptPreloads.push(node.href);
        }
        if (node.matches?.('script[src]')) window.smokeScripts.push(node.src);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const endpoint = url.pathname.replace(/^\/api(?:\/v\d+)?(?=\/)/, '');
    if (url.origin === location.origin && !url.pathname.startsWith('/api/') &&
        !endpoint.startsWith('/auth/')) {
      return originalFetch(input, init);
    }
    window.smokeApiCalls.push(`${method} ${endpoint}`);
    const respond = (data, status = 200) => Response.json(data, { status });
    if (method === 'POST' && endpoint === '/auth/login') {
      const { identifier, password } = JSON.parse(init.body);
      if (identifier !== user.email || password !== 'smoke-pass123') return respond({}, 401);
      signedIn = true;
      return respond({ accessToken: token });
    }
    if (method === 'POST' && endpoint === '/auth/refresh') {
      return signedIn ? respond({ accessToken: token }) : respond({}, 401);
    }
    if (signedIn && method === 'GET' && endpoint === '/auth/me') return respond(user);
    if (signedIn && method === 'GET' && endpoint === '/auth/security-code') {
      return respond({ enabled: false });
    }
    if (signedIn && method === 'GET' && ['/note', '/note/drafts', '/note/group'].includes(endpoint)) {
      return respond([]);
    }
    if (signedIn && method === 'DELETE' && endpoint.startsWith('/note/drafts/')) {
      return new Response(null, { status: 204 });
    }
    return respond([], 404);
  };
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function waitFor(cdp, expression, message) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await evaluate(cdp, expression);
    if (value) return value;
    await sleep(100);
  }
  throw new Error(message);
}

async function clickWhenReady(cdp, selector) {
  await waitFor(cdp, `(() => {
    const button = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find(node => node.getBoundingClientRect().height > 0 && !node.closest('[aria-hidden="true"]')
        && node.getAttribute('aria-disabled') !== 'true');
    if (!button) return false;
    button.click();
    return true;
  })()`, `Could not click ${selector}`);
}

async function checkLoginAndPrefetch(cdp, web) {
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${installLoginFixture})()`,
  });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: web.origin + '/login' });
  await loaded;
  await waitFor(cdp, `(() => {
    const password = document.querySelector(${JSON.stringify(LOGIN_PASSWORD)});
    return location.pathname === '/login' && password && !password.disabled &&
      !password.readOnly && password.getBoundingClientRect().height > 0;
  })()`, 'Cold /login did not render a usable password field');

  const editor = await evaluate(cdp, `JSON.parse(
    document.getElementById('windnote-web-prefetch-assets').textContent
  )[0]`);
  if (!/^\/_expo\/static\/js\/web\/NoteBlockEditor-[a-f0-9]{32}\.js$/.test(editor)) {
    throw new Error('Export did not list the lazy editor as the first prefetch asset');
  }
  const lowPriorityScripts = 'link[rel="preload"][as="script"][fetchpriority="low"]';
  await sleep(1_750);
  if (await evaluate(cdp, 'window.smokeScriptPreloads.length > 0') ||
      web.requests.has(editor)) {
    throw new Error('Unauthenticated login downloaded a background script');
  }

  for (const [selector, value] of [
    ['[data-testid="windnote.auth.login.email-input"]', 'smoke@example.test'],
    [LOGIN_PASSWORD, 'smoke-pass123'],
  ]) {
    await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).focus()`);
    await cdp.send('Input.insertText', { text: value });
  }
  await evaluate(cdp, `document.querySelector('[data-testid="windnote.auth.login.submit"]').click()`);
  try {
    await waitFor(cdp, `location.pathname === '/messages' &&
      !!document.querySelector('[data-testid="windnote.messages.screen"]')`, 'Fixture login did not render the messages home');
  } catch (error) {
    const state = await evaluate(cdp, '({ route: location.pathname, calls: window.smokeApiCalls })');
    throw new Error(`${error.message} (${JSON.stringify(state)})`);
  }

  const editorUrl = web.origin + editor;
  await waitFor(cdp, `Array.from(document.querySelectorAll('${lowPriorityScripts}'))
    .some(link => link.href === ${JSON.stringify(editorUrl)}) &&
    performance.getEntriesByName(${JSON.stringify(editorUrl)}, 'resource')
      .some(entry => entry.initiatorType === 'link' && entry.responseEnd > 0)`,
  'Authenticated home did not finish preloading the editor');
  const state = await evaluate(cdp, `({
    calls: window.smokeApiCalls,
    route: location.pathname,
    editorMounted: !!document.querySelector('[data-testid="note-text-section"], [contenteditable="true"]'),
    editorScript: window.smokeScripts.includes(${JSON.stringify(editorUrl)})
  })`);
  if (!state.calls.includes('POST /auth/login') || !state.calls.includes('GET /auth/me') ||
      state.calls.some(call => / \/notes?(?:\/|$)/.test(call)) ||
      state.route !== '/messages' || state.editorMounted || state.editorScript || web.requests.get(editor) !== 1) {
    throw new Error(`Background prefetch did more than download editor bytes (${JSON.stringify(state)})`);
  }

  // Navigate in the current document so Metro consumes the preloaded bytes.
  await clickWhenReady(cdp, '[data-testid="windnote.tabs.profile"]');
  await clickWhenReady(cdp, '[role="button"][aria-label="我的笔记"]');
  await clickWhenReady(cdp, '[role="button"][aria-label="创建"]');
  await clickWhenReady(cdp, '[role="button"][aria-label="文字"]');
  const editable = '[data-testid="note-text-section"] [contenteditable="true"]';
  await waitFor(cdp, `location.pathname === '/profile/notes/edit' &&
    document.querySelector('${editable}')?.getBoundingClientRect().height > 0`,
  'New note editor did not render an editable text block');
  await evaluate(cdp, `document.querySelector('${editable}').focus()`);
  await cdp.send('Input.insertText', { text: 'Production browser smoke note' });
  await waitFor(cdp, `document.querySelector('${editable}')?.textContent.includes('Production browser smoke note')`,
  'Editor did not display the typed text');
  const scriptInserted = await evaluate(cdp, `window.smokeScripts.includes(${JSON.stringify(editorUrl)})`);
  if (!scriptInserted || web.requests.get(editor) !== 1) {
    throw new Error('The production script loader downloaded the warmed editor again');
  }
  // Drop the typed test block before leaving so the editor can close without a save.
  await clickWhenReady(cdp, '[role="button"][aria-label="删除文字"]');
  await evaluate(cdp, 'history.back()');
  await waitFor(cdp, "location.pathname === '/profile/notes'", 'Editor did not return to the notes list');
  await evaluate(cdp, 'history.back()');
  await waitFor(cdp, "location.pathname === '/profile'", 'Notes did not return to profile');
  await clickWhenReady(cdp, '[data-testid="windnote.tabs.messages"]');
  await waitFor(cdp, "location.pathname === '/messages'", 'Messages home did not reopen after leaving notes');
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  process.stdout.write('Cold login, authenticated code-only prefetch and editor navigation with Metro preload reuse passed.\n');
}

async function checkStalledStartup(cdp, url, pattern, resourceType) {
  const acceleratedTimeout = resourceType === 'Script' ? 2_000 : 50;
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      localStorage.removeItem('circle-im-web-startup-diagnostics-v1');
      const nativeTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 60000 ? ${acceleratedTimeout} : delay, ...args);
      window.fetch = () => Promise.resolve({ok: true});
    `,
  });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  let paused = 0;
  cdp.on('Fetch.requestPaused', (event) => {
    if (event.resourceType === resourceType) paused++;
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: pattern, resourceType }] });
  await cdp.send('Page.navigate', { url });
  const deadline = Date.now() + 10_000;
  let state;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        navigationUrl: performance.getEntriesByType('navigation')[0]?.name,
        installed: !!window.__WINDNOTE_WEB_STARTUP__,
        report: JSON.parse(localStorage.getItem('circle-im-web-startup-diagnostics-v1') || 'null'),
        panel: !!document.getElementById('windnote-startup-diagnostic')
      })`,
      returnByValue: true,
    });
    state = result.result?.value ? JSON.parse(result.result.value) : {};
    if (paused && state.navigationUrl === url && state.installed &&
        state.report?.kind === 'startupTimeout' && state.panel) {
      await cdp.send('Fetch.disable');
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
      process.stdout.write(`Startup watchdog reports while a ${resourceType} request remains paused.\n`);
      return;
    }
    await sleep(50);
  }
  throw new Error(`Startup watchdog did not report while a ${resourceType} request was stalled (${paused} paused requests, ${JSON.stringify(state)}).`);
}

async function checkLoginChunkRetry(cdp, origin, loginChunkPattern) {
  const pause = cdp.once('Fetch.requestPaused');
  const firstLoad = cdp.once('Page.loadEventFired');
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: loginChunkPattern, resourceType: 'Script' }] });
  await cdp.send('Page.navigate', { url: origin + '/login' });
  const { requestId } = await pause;
  await cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
  await cdp.send('Fetch.disable');
  await firstLoad;
  const retry = '[data-testid="router_error_retry"]';
  await waitFor(cdp, `!!document.querySelector('${retry}')`, 'Failed login chunk did not show the route retry button');
  const reload = cdp.once('Page.loadEventFired');
  await evaluate(cdp, `document.querySelector('${retry}').click()`);
  await reload.catch(() => { throw new Error('Route retry did not reload after a failed login chunk'); });
  await waitFor(cdp, `location.pathname === '/login' &&
    performance.getEntriesByType('navigation')[0]?.type === 'reload' &&
    !!document.querySelector(${JSON.stringify(LOGIN_PASSWORD)})`,
  'Retry did not restore the login form after the chunk became available');
  process.stdout.write('Login recovered from a failed route chunk using the route retry button.\n');
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('dist/index.html missing; run expo export first');
  }
  const web = await startServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'circle-web-smoke-'));
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  // Chrome 的 stderr 是启动失败时唯一的线索，丢掉它等于让 CI 只能靠重跑碰运气。
  // 只留尾部若干 KB：既够定位原因，也不会把日志刷爆。
  let chromeStderr = '';
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', (chunk) => {
    chromeStderr = `${chromeStderr}${chunk}`.slice(-8_000);
  });
  // spawn 自身失败（EACCES/ENOEXEC）走 'error' 事件；没有监听器时 Node 直接
  // 抛未捕获异常，栈里看不出跟 Chrome 有关。
  let spawnError = null;
  chrome.on('error', (error) => {
    spawnError = error;
  });
  const readStderr = () => {
    const parts = [];
    if (spawnError) parts.push(`Chrome spawn error: ${spawnError.message}`);
    parts.push(chromeStderr.trim() ? `Chrome stderr:\n${chromeStderr.trim()}` : 'Chrome stderr: (empty)');
    return parts.join('\n');
  };
  let cdp;

  try {
    const port = await waitForDevTools(userDataDir, chrome, readStderr);
    const page = await fetch(`http://127.0.0.1:${port}/json/new`, {
      method: 'PUT',
    }).then((response) => response.json());
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.open();
    const exceptions = [];
    cdp.on('Runtime.exceptionThrown', (event) => {
      const details = event.exceptionDetails || {};
      exceptions.push(
        details.exception?.description ||
          details.exception?.value ||
          `${details.text || 'runtime exception'} at ${details.url || 'unknown'}:${details.lineNumber ?? '?'}`,
      );
    });
    await Promise.all([
      cdp.send('Runtime.enable'),
      cdp.send('Page.enable'),
      cdp.send('Network.enable'),
    ]);
    await cdp.send('Network.setBlockedURLs', { urls: ['https://*', 'wss://*', 'ws://*'] });

    for (const route of ['/', `/qr?t=${'q'.repeat(32)}`]) {
      exceptions.length = 0;
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: `${web.origin}${route}` });
      await loaded;
      await sleep(1_500);
      const evaluation = await cdp.send('Runtime.evaluate', {
        expression: `JSON.stringify({ pathname: location.pathname, rootChildren: document.querySelector('#root')?.childElementCount ?? 0, body: document.body.innerText })`,
        returnByValue: true,
      });
      const state = JSON.parse(evaluation.result.value);
      if (state.rootChildren < 1 || /not found|cannot get/i.test(state.body)) {
        throw new Error(`Web smoke rendered an invalid page for ${route}`);
      }
      if (exceptions.length) {
        throw new Error(`Web runtime exception on ${route}: ${exceptions.join('; ')}`);
      }
    }
    await checkMobileRegistration(cdp, web.origin);
    if (exceptions.length) {
      throw new Error(`Mobile registration runtime exception: ${exceptions.join('; ')}`);
    }
    exceptions.length = 0;
    await checkLoginAndPrefetch(cdp, web);
    if (exceptions.length) {
      throw new Error(`Login/prefetch runtime exception: ${exceptions.join('; ')}`);
    }
    if (web.missing.length) {
      throw new Error(`Web export referenced missing local assets: ${web.missing.join(', ')}`);
    }
    await cdp.send('Storage.clearDataForOrigin', { origin: web.origin, storageTypes: 'all' });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const loginChunk = fs.readdirSync(path.join(DIST, '_expo/static/js/web'))
      .find((asset) => /^login-[a-f0-9]{32}\.js$/.test(asset));
    if (!loginChunk) throw new Error('Web export is missing the split login route');
    const loginChunkPattern = `${web.origin}/_expo/static/js/web/${loginChunk}`;
    await checkLoginChunkRetry(cdp, web.origin, loginChunkPattern);
    await checkStalledStartup(cdp, `${web.origin}/login?startup-script-stall=1`, loginChunkPattern, 'Script');
    await checkStalledStartup(cdp, `${web.origin}/?startup-css-stall=1`,
      `${web.origin}/_expo/static/css/*`, 'Stylesheet');
    process.stdout.write('Web export browser smoke passed for /, the /qr deep link and mobile registration.\n');
  } finally {
    await closeBrowser(cdp);
    await stopProcess(chrome);
    await new Promise((resolve) => web.server.close(resolve));
    removeUserDataDir(userDataDir);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
