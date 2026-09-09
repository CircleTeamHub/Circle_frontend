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

test('a long text block retains the last paragraph in the detail view', () => {
  const text = '大段文字\n'.repeat(4000) + '最后一段';
  render(<NoteBlockRenderer blocks={[{ type: 'paragraph', content: [{ text }] }]} />);
  expect(screen.getByText(text)).toBeTruthy();
});
