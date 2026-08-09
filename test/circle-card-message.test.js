const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function loadTsModule(relativePath, stubs = {}) {
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
    require: (specifier) => {
      if (specifier in stubs) {
        return stubs[specifier];
      }
      return require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}


test('circle card: bubble renders and taps through to the circle detail', () => {
  const bubble = read(
    'src/features/chat/components/bubbles/circle-card-bubble.tsx',
  );
  assert.match(bubble, /export const CircleCardBubble/);
  assert.match(bubble, /message\.circleCard/);
  // The bubble uses the sent snapshot. The detail screen owns live fetching,
  // which avoids an N+1 request pattern while scrolling chat history.
  assert.doesNotMatch(bubble, /fetchCircleDetail\(circleId\)/);
  assert.match(bubble, /displayName/);
  assert.match(bubble, /displayAvatar/);

  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(chat, /case 'circle-card':/);
  assert.match(chat, /<CircleCardBubble/);
  // tapping opens the circle detail (where the join button lives)
  assert.match(chat, /getCircleDetailHref\([\s\S]*card\.circleId/);
});

test('circle card bubble uses a compact card layout independent of friend cards', () => {
  const shared = read('src/features/chat/components/bubbles/shared.tsx');
  const bubble = read(
    'src/features/chat/components/bubbles/circle-card-bubble.tsx',
  );

  assert.match(shared, /const sCircleCard = StyleSheet\.create/);
  assert.match(shared, /card:\s*\{[\s\S]*width:\s*CHAT_CARD_STANDARD_WIDTH/);
  assert.match(
    shared,
    /card:\s*\{[\s\S]*paddingVertical:\s*CHAT_CARD_PADDING_VERTICAL/,
  );
  assert.match(bubble, /<CircleAvatar[\s\S]*size=\{48\}/);
  assert.match(shared, /sCircleCard\.card/);
  assert.doesNotMatch(shared, /const CHAT_CARD_WIDTH = 220/);
});

test('ShareCircleCardScreen sends the card to a chosen conversation', () => {
  const share = read(
    'src/features/discover/screens/ShareCircleCardScreen.tsx',
  );
  assert.match(share, /useTranslation/);
  assert.doesNotMatch(share, /Alert\.alert\(\s*'发送圈子名片'/);
  // 契约随自研栈迁移更新(意图不变):卡片经 chat-core 发进所选会话。
  assert.match(share, /sendCardMessage/);
  assert.match(share, /conversationId: conversation\.id/);
  assert.match(share, /type: 'circle-card'/);
});

test('ShareCircleCardScreen does not leave a row stuck in sending state when SDK send hangs', () => {
  const share = read(
    'src/features/discover/screens/ShareCircleCardScreen.tsx',
  );

  assert.match(share, /SENDING_STATE_FALLBACK_MS/);
  assert.match(share, /sendingTimeoutRef/);
  assert.match(share, /setTimeout\(\(\) => \{/);
  assert.match(share, /const mountedRef = useRef\(true\)/);
  assert.match(share, /mountedRef\.current = false/);
  assert.match(share, /if \(mountedRef\.current\) setSendingConversationID\(''\)/);
  assert.match(share, /if \(!mountedRef\.current\) return;[\s\S]*setSendingConversationID\(''\)/);
  assert.match(share, /\.then\(\(\) => \{[\s\S]*if \(!mountedRef\.current\) return;[\s\S]*Alert\.alert/);
  assert.match(share, /\.catch\(\(error: unknown\) => \{[\s\S]*if \(!mountedRef\.current\) return;[\s\S]*Alert\.alert/);
  assert.match(share, /clearTimeout/);
});

