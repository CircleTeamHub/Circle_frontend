const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadHook() {
  const filePath = path.join(process.cwd(), 'src/hooks/use-elapsed-seconds.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === 'react') return { useEffect: () => {}, useState: () => [] };
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('elapsedSecondsSince reports 0 only when not started', () => {
  const { elapsedSecondsSince } = loadHook();

  assert.equal(elapsedSecondsSince(null, 1_000_000), 0);

  // 地板是 1：刚按下时显示「0 秒」既没意义也会闪一下。
  assert.equal(elapsedSecondsSince(1_000_000, 1_000_000), 1);
  assert.equal(elapsedSecondsSince(1_000_000, 1_000_100), 1);
});

test('elapsedSecondsSince rounds to whole seconds', () => {
  const { elapsedSecondsSince } = loadHook();
  const start = 1_000_000;

  assert.equal(elapsedSecondsSince(start, start + 1_400), 1);
  assert.equal(elapsedSecondsSince(start, start + 1_600), 2);
  assert.equal(elapsedSecondsSince(start, start + 12_000), 12);
});

test('chat screen no longer polls native recorder state on every render tick', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  // useAudioRecorderState(recorder, 250) 每 250ms 同步调 native getStatus() 并 setState
  // 一个新对象，让整个聊天页从挂载到卸载常驻 4Hz 重渲染（不止录音时）。改回去等于
  // 把这个放大器又装上：任何别的卡顿都会被它放大成肉眼可见的无响应。
  assert.doesNotMatch(
    source,
    /useAudioRecorderState/,
    'chat screen must not subscribe to the 250ms native recorder poll',
  );
  assert.match(source, /useElapsedSeconds\(voiceRecordingStartedAt\)/);
});
