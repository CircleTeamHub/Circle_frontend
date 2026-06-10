const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: {
        '@/*': ['src/*'],
      },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('buildCollectionInputFromMessage stores voice OpenIM metadata without uploading again', () => {
  const { buildCollectionInputFromMessage } = loadTsModule(
    'src/features/chat/utils/message-collection.ts',
  );

  const input = buildCollectionInputFromMessage(
    {
      id: 'msg-voice-1',
      type: 'voice',
      outgoing: false,
      senderID: 'peer-1',
      senderName: 'Peer',
      time: '16:20',
      voiceUrl: 'https://cdn.example.com/voice.m4a',
      voicePath: '',
      voiceDuration: 4,
    },
    {
      conversationID: 'si_me_peer',
      conversationTitle: 'Peer Chat',
    },
  );

  assert.deepEqual(JSON.parse(JSON.stringify(input)), {
    type: 'VOICE',
    title: '语音消息',
    summary: '4 秒语音',
    sourceID: 'msg-voice-1',
    payload: {
      kind: 'openim-message',
      messageID: 'msg-voice-1',
      messageType: 'voice',
      conversationID: 'si_me_peer',
      conversationTitle: 'Peer Chat',
      senderID: 'peer-1',
      senderName: 'Peer',
      time: '16:20',
      voice: {
        sourceUrl: 'https://cdn.example.com/voice.m4a',
        soundPath: '',
        duration: 4,
      },
    },
  });
});

test('collected voice round-trips dataSize so re-sent remote voice is not 0KB', () => {
  const { buildCollectionInputFromMessage, getCollectedOpenIMMessagePayload } =
    loadTsModule('src/features/chat/utils/message-collection.ts');

  const input = buildCollectionInputFromMessage(
    {
      id: 'msg-voice-2',
      type: 'voice',
      outgoing: false,
      voiceUrl: 'https://cdn.example.com/voice.m4a',
      voicePath: '',
      voiceDuration: 4,
      voiceSize: 20480,
    },
    { conversationID: 'si_me_peer', conversationTitle: 'Peer Chat' },
  );

  assert.equal(input.payload.voice.dataSize, 20480);

  // And the reverse mapper recovers it for re-send.
  const recovered = getCollectedOpenIMMessagePayload(
    JSON.parse(JSON.stringify(input.payload)),
  );
  assert.equal(recovered.voice.dataSize, 20480);
});
