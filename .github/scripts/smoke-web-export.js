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
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
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
    if (fs.existsSync(activePort)) {
      const [port] = fs.readFileSync(activePort, 'utf8').trim().split('\n');
      return Number(port);
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

    for (const route of ['/', `/qr-login?token=${'q'.repeat(32)}`]) {
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
    if (web.missing.length) {
      throw new Error(`Web export referenced missing local assets: ${web.missing.join(', ')}`);
    }
    process.stdout.write('Web export browser smoke passed for / and /qr-login deep link.\n');
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
