const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 待发媒体副本的磁盘足迹:用一个内存文件系统顶替 react-native-fs,看登出清理到底删了什么。

function createMemoryFS() {
  const directories = new Set();
  const files = new Map();
  const parentOf = (p) => p.slice(0, p.lastIndexOf('/'));
  const fsApi = {
    DocumentDirectoryPath: '/docs',
    async mkdir(p) {
      let current = p;
      while (current && current !== '/docs' && !directories.has(current)) {
        directories.add(current);
        current = parentOf(current);
      }
    },
    async exists(p) {
      return directories.has(p) || files.has(p);
    },
    async copyFile(source, target) {
      files.set(target, `copy-of:${source}`);
    },
    async unlink(p) {
      files.delete(p);
      directories.delete(p);
      for (const key of [...files.keys()]) if (key.startsWith(`${p}/`)) files.delete(key);
      for (const key of [...directories]) if (key.startsWith(`${p}/`)) directories.delete(key);
    },
    async readDir(p) {
      const children = new Set();
      for (const key of [...directories, ...files.keys()]) {
        if (parentOf(key) === p) children.add(key);
      }
      return [...children].map((child) => ({
        name: child.slice(child.lastIndexOf('/') + 1),
        path: child,
        mtime: new Date(0),
        isDirectory: () => directories.has(child),
      }));
    },
  };
  return fsApi;
}

function loadPendingMedia(memoryFS) {
  const filePath = path.join(process.cwd(), 'src/chat-core/pending-media.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  });
  const context = {
    module: { exports: {} },
    exports: {},
    Date,
    require: (request) => {
      if (request === 'react-native') return { Platform: { OS: 'android' } };
      if (request === 'react-native-fs') return memoryFS;
      if (request === '@/observability/report-failure') {
        return { reportHandledFailure: () => {} };
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(outputText, context, { filename: filePath });
  return context.module.exports;
}

const root = '/docs/chat-outbox';

test('logging out removes the unsent media of the session being logged out, even a failed upload still on screen', async () => {
  const memoryFS = createMemoryFS();
  const media = loadPendingMedia(memoryFS);
  // 会话 5 里发了一张图,上传失败:红气泡还在,副本没人删,这条 d 一直算「进行中」。
  assert.equal(
    await media.persistPendingMediaFile('u1', 'd-failed', 'file:///cache/a.jpg', 'a.jpg', 5),
    'media.jpg',
  );
  assert.equal(await memoryFS.exists(`${root}/u1/d-failed`), true);

  // 登出:clearSession 把会话编号推到 6 之后清理。原来「进行中」的一律跳过,
  // 这张没发出去的照片就留在了设备上。
  await media.clearPendingMediaFiles(6);

  assert.equal(await memoryFS.exists(`${root}/u1/d-failed`), false);
});

test('a send started by a newer session while the logout was still clearing keeps its copy', async () => {
  const memoryFS = createMemoryFS();
  const media = loadPendingMedia(memoryFS);
  await media.persistPendingMediaFile('u1', 'd-old', 'file:///cache/old.jpg', 'old.jpg', 5);
  // 登出被抢占:清理跑到一半时已经重新登录(会话 7)并点了发送。
  await media.persistPendingMediaFile('u1', 'd-new', 'file:///cache/new.jpg', 'new.jpg', 7);

  await media.clearPendingMediaFiles(6);

  assert.equal(await memoryFS.exists(`${root}/u1/d-old`), false);
  assert.equal(await memoryFS.exists(`${root}/u1/d-new`), true);
});

test('logout also sweeps copies other accounts should already have cleared', async () => {
  // 换账号一律先走完整的登出清理,所以按设计登出时不该还有别的账号的待发副本;
  // 真留下的(那次清理删失败)也是本该删掉的隐私残留,一并清掉。
  const memoryFS = createMemoryFS();
  const media = loadPendingMedia(memoryFS);
  await media.persistPendingMediaFile('u2', 'd-leftover', 'file:///cache/b.m4a', 'b.m4a', 3);
  await media.clearPendingMediaFiles(6);
  assert.equal(await memoryFS.exists(`${root}/u2/d-leftover`), false);
});
