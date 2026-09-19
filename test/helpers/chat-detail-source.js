const fs = require('node:fs');
const path = require('node:path');

/**
 * 聊天详情页的源码断言入口。
 *
 * ChatDetailScreen.tsx 原本是一个 4700 行的文件,2026-09 按功能拆进了
 * src/features/chat/chat-detail/(hooks、组件、常量、样式),代码文本原样搬运。
 * 源码断言要看的是「这段逻辑还在不在、写法对不对」,不在乎它落在哪个文件里,
 * 所以这里把页面文件和拆出去的模块按原文件里的先后顺序拼成一份再交给断言 ——
 * 跨段落的 `A[\s\S]*B` 正则因此保持原来的前后关系。
 *
 * 新增 chat-detail 模块时不必改这里:没在 ORDER 里的文件按路径排序追加在后面。
 */
const CHAT_DETAIL_SCREEN = 'src/features/chat/screens/ChatDetailScreen.tsx';
const CHAT_DETAIL_MODULE_DIR = 'src/features/chat/chat-detail';

const ORDER = [
  'constants.ts',
  'types.ts',
  'helpers.ts',
  'styles.ts',
  'hooks/use-chat-conversation.ts',
  'hooks/use-keyboard-visible.ts',
  'hooks/use-chat-background.ts',
  'hooks/use-chat-header.ts',
  'hooks/use-chat-detail-themed-styles.ts',
  'hooks/use-burn-notice.ts',
  'hooks/use-chat-timeline.ts',
  'hooks/use-collect-message.ts',
  'hooks/use-message-actions.ts',
  'hooks/use-message-renderer.tsx',
  'hooks/use-chat-call.ts',
  'hooks/use-composer-panels.ts',
  'hooks/use-composer-input.ts',
  'hooks/use-quick-text-send.ts',
  'hooks/use-voice-recording.ts',
  'hooks/use-location-send.ts',
  'hooks/use-media-send.ts',
  'hooks/use-attachment-actions.ts',
  'hooks/use-note-batch-send.ts',
  'hooks/use-composer-send.ts',
  'components/ChatDetailHeader.tsx',
  'components/ChatMessageArea.tsx',
  'components/MentionPickerPanel.tsx',
  'components/ComposerBanners.tsx',
  'components/ChatComposerBar.tsx',
  'components/AttachmentPanel.tsx',
];

function listModuleFiles(root) {
  const base = path.join(root, CHAT_DETAIL_MODULE_DIR);
  const found = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        found.push(path.relative(base, full).split(path.sep).join('/'));
      }
    }
  })(base);
  const ordered = ORDER.filter((rel) => found.includes(rel));
  const rest = found.filter((rel) => !ORDER.includes(rel)).sort();
  return [...ordered, ...rest].map((rel) => `${CHAT_DETAIL_MODULE_DIR}/${rel}`);
}

/** 聊天详情页的完整源码:页面文件在前,拆出去的模块按原先后顺序接在后面。 */
function readChatDetailSource(root = process.cwd()) {
  return [CHAT_DETAIL_SCREEN, ...listModuleFiles(root)]
    .map((rel) => fs.readFileSync(path.join(root, rel), 'utf8'))
    .join('\n');
}

/** 读仓库里的源码文件;聊天详情页返回合并后的完整源码。 */
function readSourceFile(relativePath, root = process.cwd()) {
  if (relativePath === CHAT_DETAIL_SCREEN) return readChatDetailSource(root);
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

module.exports = {
  CHAT_DETAIL_SCREEN,
  CHAT_DETAIL_MODULE_DIR,
  listModuleFiles,
  readChatDetailSource,
  readSourceFile,
};
