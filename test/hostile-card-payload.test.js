// 对方可控的 cardElem.ex 是一段 JSON。它一旦能让映射或渲染抛异常，就不只是「这条
// 消息显示不出来」——异常会冒泡到 ChatDetailScreen 的 messages useMemo，整个聊天页
// 渲染失败；而消息是持久化的，重进会话会再次触发，等于一条构造过的消息永久搞坏这个
// 会话。这些用例锁住映射层的收口。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: { '@/*': ['src/*'] },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) =>
      specifier in stubs ? stubs[specifier] : require(specifier),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const MAPPER_STUBS = {
  '@openim/rn-client-sdk': {
    MessageType: {
      TextMessage: 101,
      PictureMessage: 102,
      VoiceMessage: 103,
      VideoMessage: 104,
      FileMessage: 105,
      CardMessage: 108,
      LocationMessage: 109,
      CustomMessage: 110,
      TypingMessage: 113,
    },
    SessionType: { Single: 1, Group: 2 },
  },
  '@/im/client': {
    NOTE_CARD_EXTENSION: 'note-card-v1',
    TRANSFER_CARD_EXTENSION: 'transfer-card-v1',
    VERIFICATION_CARD_EXTENSION: 'circle-verify-v1',
    fromImUserId: (userID) => userID,
  },
  '@/services/api/utils': { normalizeMediaUrl: (url) => url },
  '@/i18n': {
    __esModule: true,
    default: { language: 'zh', t: (_key, options) => options.defaultValue },
  },
  '@/utils/locale': { getLocalizedDateTimeLocale: () => 'zh-CN' },
};

function cardMessage(ex) {
  return {
    clientMsgID: 'msg-hostile',
    sendID: 'peer',
    recvID: 'self',
    sessionType: 1,
    contentType: 108,
    sendTime: Date.now(),
    status: 2,
    isRead: false,
    cardElem: { userID: 'peer', nickname: 'peer', faceURL: '', ex },
  };
}

test('hostile card ex payloads never throw during mapping', () => {
  const { createMessageMapCache, mapMessageItemsToChatMessages } = loadTsModule(
    'src/im/mappers.ts',
    MAPPER_STUBS,
  );

  // 'null' 是最刁的一个：JSON.parse('null') **不抛异常**，它成功并返回 null，
  // 于是 try 之外的 ext.kind 解引用 null 才抛 —— catch 根本拦不到。
  const payloads = [
    'null',
    'false',
    '0',
    '"a string"',
    '[]',
    '[1,2,3]',
    '{"displayIcons":"not-an-array"}',
    '{"displayIcons":{"length":3}}',
    '{"displayIcons":null}',
    '{"kind":null}',
    'not json at all',
    '',
  ];

  for (const ex of payloads) {
    const cache = createMessageMapCache('self');
    assert.doesNotThrow(
      () => mapMessageItemsToChatMessages([cardMessage(ex)], 'self', cache),
      `mapping must survive cardElem.ex = ${JSON.stringify(ex)}`,
    );
  }
});

test('persona is only ever a string or null', () => {
  const { createMessageMapCache, mapMessageItemsToChatMessages } = loadTsModule(
    'src/im/mappers.ts',
    MAPPER_STUBS,
  );

  // 气泡里是 card.persona?.trim() —— `?.` 只挡 null/undefined，挡不住数字/对象。
  for (const hostile of [
    '{"persona":123}',
    '{"persona":{"a":1}}',
    '{"persona":[1,2]}',
    '{"persona":true}',
  ]) {
    const cache = createMessageMapCache('self');
    const [mapped] = mapMessageItemsToChatMessages(
      [cardMessage(hostile)],
      'self',
      cache,
    );
    const persona = mapped.friendCard?.persona;
    assert.ok(
      persona === null || typeof persona === 'string',
      `persona must be string|null for ex = ${hostile}, got ${typeof persona}`,
    );
  }
});

test('every surviving displayIcon is safe to render', () => {
  const { createMessageMapCache, mapMessageItemsToChatMessages } = loadTsModule(
    'src/im/mappers.ts',
    MAPPER_STUBS,
  );

  // 只校验容器不够：数组合法、元素却能是 null 或带对象字段的假图标。
  // 气泡会 icon.imageUrl 解引用、把 icon.title 塞进 <Text>（对象会让 React 直接抛）。
  const hostile =
    '{"displayIcons":[null,{"id":"a","title":{"evil":1}},{"id":{"x":1},"title":"t"},' +
    '{"id":"ok","title":"good","imageUrl":{"nope":1}},"a string",[1,2],' +
    '{"id":"ok2","title":"good2","imageUrl":"https://x/y.png"}]}';
  const cache = createMessageMapCache('self');
  const [mapped] = mapMessageItemsToChatMessages(
    [cardMessage(hostile)],
    'self',
    cache,
  );

  const icons = mapped.friendCard?.displayIcons ?? [];
  for (const icon of icons) {
    assert.equal(typeof icon.id, 'string');
    assert.equal(typeof icon.title, 'string');
    assert.ok(icon.imageUrl === null || typeof icon.imageUrl === 'string');
  }
  // 合法的那两个必须留下来 —— 净化不能顺手把好数据也丢了。
  // 用 join 而不是 deepStrictEqual：mappers 跑在 vm 沙箱里，它造的数组原型链与本
  // realm 不同，deepStrictEqual 会因为原型不同而判不等（值其实一样）。
  assert.equal([...icons].map((i) => i.id).join(','), 'ok,ok2');
});

test('displayIcons is always an array downstream, whatever the peer sent', () => {
  const { createMessageMapCache, mapMessageItemsToChatMessages } = loadTsModule(
    'src/im/mappers.ts',
    MAPPER_STUBS,
  );

  // 气泡里是 `displayIcons.length > 0 && displayIcons.slice(0,4).map(...)`。
  // 传字符串能过 length 判断，然后 .map 不存在 → 渲染抛错。所以收口必须在映射层，
  // 让下游拿到的永远是数组。
  for (const hostile of [
    '{"displayIcons":"xxxxx"}',
    '{"displayIcons":{"length":9}}',
    '{"displayIcons":123}',
  ]) {
    const cache = createMessageMapCache('self');
    const [mapped] = mapMessageItemsToChatMessages(
      [cardMessage(hostile)],
      'self',
      cache,
    );
    assert.ok(
      Array.isArray(mapped.friendCard?.displayIcons),
      `displayIcons must be an array for ex = ${hostile}`,
    );
  }
});
