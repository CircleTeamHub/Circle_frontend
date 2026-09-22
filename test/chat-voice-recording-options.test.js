const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 语音消息的录音参数。原来用 RecordingPresets.LOW_QUALITY:安卓那一档是 3gp 容器里的
// AMR-NB,iPhone 解不了 AMR —— 安卓发的语音在 iPhone 上放不出来。
const root = process.cwd();

function loadOptions() {
  const filePath = path.join(root, 'src/features/chat/utils/voice-recording-options.ts');
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === 'expo-audio') {
        return {
          AudioQuality: { MIN: 0, LOW: 32, MEDIUM: 64, HIGH: 96, MAX: 127 },
          IOSOutputFormat: { MPEG4AAC: 'aac ' },
        };
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(output, context);
  return context.module.exports.VOICE_RECORDING_OPTIONS;
}

test('both platforms record voice as mono AAC in an m4a container', () => {
  const options = loadOptions();
  assert.equal(options.extension, '.m4a');
  assert.equal(options.numberOfChannels, 1);
  assert.ok(options.bitRate <= 48000, 'voice does not need music bitrates');
  assert.equal(options.android.outputFormat, 'mpeg4');
  assert.equal(options.android.audioEncoder, 'aac');
  assert.equal(options.android.extension, '.m4a');
  assert.equal(options.ios.outputFormat, 'aac ');
});

test('the chat voice recorder uses these options, not the AMR preset', () => {
  const hook = fs.readFileSync(
    path.join(root, 'src/features/chat/chat-detail/hooks/use-voice-recording.ts'),
    'utf8',
  );
  assert.match(hook, /useAudioRecorder\(VOICE_RECORDING_OPTIONS\)/);
  assert.doesNotMatch(hook, /RecordingPresets\.LOW_QUALITY/);
});
