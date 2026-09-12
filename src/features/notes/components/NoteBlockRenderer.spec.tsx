import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { NoteBlockRenderer } from './NoteBlockRenderer';

jest.mock('expo', () => ({ useEventListener: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: () => null }));
jest.mock('@/theme', () => ({
  Spacing: { xs: 4, sm: 8, md: 16 },
  Radius: { md: 8, lg: 12 },
  Typography: { h1: {}, h2: {}, h3: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({ colors: { text: '#fff', textSecondary: '#fff', primary: '#6366F1' } }),
}));

test('pasted rich text displays link labels, nested lists, checklists and tables', () => {
  render(<NoteBlockRenderer blocks={[
    {
      type: 'bulletListItem', content: [{ text: '顶层列表' }],
      children: [{
        type: 'checkListItem', props: { checked: true },
        content: [{ type: 'link', content: [{ text: '链接中的子项文字' }] }],
        children: [{ type: 'paragraph', content: [{ text: '第三层正文' }] }, null],
      }],
    },
    { type: 'table', content: { type: 'tableContent', rows: [
      { cells: [[{ text: '第一格' }], { type: 'tableCell', content: [{ text: '第二格' }] }] },
    ] } },
    { type: 'toggleListItem', content: [{ text: '折叠列表标题' }] },
  ]} />);
  for (const text of ['顶层列表', '链接中的子项文字', '第三层正文', '第一格\t第二格', '折叠列表标题']) {
    expect(screen.getByText(text)).toBeTruthy();
  }
});

// 粘贴进来的文档里混着编辑器没规范化过的节点：整块是 null、行内内容直接是字符串。
// 以前前者会在读 block.id 时直接抛错、把整页详情打没，后者被当成没有 text 而丢掉。
test('malformed pasted blocks keep the rest of the note readable', () => {
  const blocks = [
    null,
    { type: 'paragraph', content: ['粘贴来的纯字符串'] },
    { type: 'paragraph', content: [{ text: '正文结束' }] },
  ] as unknown as Record<string, unknown>[];
  render(<NoteBlockRenderer blocks={blocks} />);
  expect(screen.getByText('粘贴来的纯字符串')).toBeTruthy();
  expect(screen.getByText('正文结束')).toBeTruthy();
});

test('server-provided child blocks stop at the supported nesting depth', () => {
  const root: Record<string, unknown> = {
    type: 'paragraph',
    content: [{ text: '第0层' }],
  };
  let parent = root;
  for (let depth = 1; depth <= 11; depth += 1) {
    const child = {
      type: 'paragraph',
      content: [{ text: `第${depth}层` }],
    };
    parent.children = [child];
    parent = child;
  }

  render(<NoteBlockRenderer blocks={[root]} />);

  expect(screen.getByText('第10层')).toBeTruthy();
  expect(screen.queryByText('第11层')).toBeNull();
});

test('server-provided inline content stops at the supported nesting depth', () => {
  const root: Record<string, unknown> = { type: 'link', text: '行内第0层' };
  let parent = root;
  for (let depth = 1; depth <= 11; depth += 1) {
    const child = { type: 'link', text: `行内第${depth}层` };
    parent.content = [child];
    parent = child;
  }

  const view = render(
    <NoteBlockRenderer
      blocks={[{ type: 'paragraph', content: [root] }]}
    />,
  );

  const tree = JSON.stringify(view.toJSON());
  expect(tree).toContain('行内第10层');
  expect(tree).not.toContain('行内第11层');
});
