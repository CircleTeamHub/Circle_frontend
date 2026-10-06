type Block = Record<string, unknown>;

// 与服务端的结构化笔记遍历上限一致；服务端 JSON 属于不可信输入，不能让任意深度
// 的 children/content 把 JS 调用栈耗尽。
export const MAX_NOTE_BLOCK_DEPTH = 10;

/** 包括粘贴内容中的链接文字和两种 BlockNote 表格单元格格式。 */
function extractInlineTextAtDepth(content: unknown, depth: number): string {
  if (depth > MAX_NOTE_BLOCK_DEPTH) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((node) => extractInlineTextAtDepth(node, depth + 1))
      .join('');
  }
  if (!content || typeof content !== 'object') return '';
  const node = content as Block;
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.rows)) {
    return node.rows.map((row) => {
      const cells = row && typeof row === 'object' ? (row as Block).cells : null;
      return Array.isArray(cells)
        ? cells
            .map((cell) => extractInlineTextAtDepth(cell, depth + 1))
            .join('\t')
        : '';
    }).join('\n');
  }
  return extractInlineTextAtDepth(node.content, depth + 1);
}

export function extractInlineText(content: unknown): string {
  return extractInlineTextAtDepth(content, 0);
}

/**
 * Flatten all text blocks into a single plain text string (for the `content` field).
 */
function extractPlainTextAtDepth(blocks: Block[], depth: number): string {
  if (depth > MAX_NOTE_BLOCK_DEPTH) return '';
  return blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const text = extractInlineText(block.content);
      const children = Array.isArray(block.children)
        ? extractPlainTextAtDepth(block.children as Block[], depth + 1)
        : '';
      return [text, children].filter(Boolean).join('\n');
    })
    .filter(Boolean)
    .join('\n');
}

export function extractPlainText(blocks: Block[]): string {
  return extractPlainTextAtDepth(blocks, 0);
}
