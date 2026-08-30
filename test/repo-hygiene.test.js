const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// 依赖目录一旦进了索引就是机器相关的：worktree 里的 node_modules 常常是一条指向
// 某台机器绝对路径的符号链接，别人检出就得到一条悬空链接，`npm ci` 之后工作区
// 还一直是脏的。.gitignore 里只有 `node_modules/`（带斜杠）挡不住符号链接。
test('node_modules never enters the index', () => {
  const safeDirectory = process.cwd().split(path.sep).join('/');
  const tracked = execFileSync(
    'git',
    [
      '-c',
      `safe.directory=${safeDirectory}`,
      'ls-files',
      '--',
      'node_modules',
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  ).trim();

  assert.equal(tracked, '', `node_modules 被跟踪了：\n${tracked}`);

  const ignore = fs.readFileSync(
    path.join(process.cwd(), '.gitignore'),
    'utf8',
  );
  const rules = ignore.split('\n').map((line) => line.trim());
  assert.ok(rules.includes('node_modules'), '.gitignore 需要一条不带斜杠的规则');
  assert.ok(rules.includes('node_modules/'), '.gitignore 需要保留目录规则');
});
