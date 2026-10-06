import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useVideoPlayer } from 'expo-video';
import { NoteBlockRenderer } from './NoteBlockRenderer';

jest.mock('expo', () => ({ useEventListener: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
const mockAudioPlayer = {
  isLoaded: true,
  addListener: jest.fn((_event: string, _listener: (status: any) => void) => ({ remove: jest.fn() })),
  play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(() => Promise.resolve()),
};
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => mockAudioPlayer,
}));
const mockVideoPlayer = {
  loop: true,
  mounted: false,
  play: jest.fn(() => {
    if (!mockVideoPlayer.mounted) throw new Error('No video view is attached');
  }),
};
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn((url, setup) => jest.requireActual<typeof import('react')>('react').useMemo(() => {
    setup?.(mockVideoPlayer);
    return mockVideoPlayer;
  }, [url])),
  VideoView: ({ player }: { player: typeof mockVideoPlayer }) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      player.mounted = true;
      return () => { player.mounted = false; };
    }, [player]);
    return null;
  },
}));
let mockLanguage = 'en';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const locale = mockLanguage === 'zh'
        ? require('@/i18n/locales/zh.json')
        : require('@/i18n/locales/en.json');
      return key.split('.').reduce((value: any, part) => value?.[part], locale) ?? key;
    },
  }),
}));
jest.mock('@/theme', () => ({
  Spacing: { xs: 4, sm: 8, md: 16 },
  Radius: { md: 8, lg: 12 },
  Typography: { h1: {}, h2: {}, h3: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({ colors: { text: '#fff', textSecondary: '#fff', primary: '#6366F1' } }),
}));

beforeEach(() => {
  mockLanguage = 'en';
  mockVideoPlayer.play.mockClear();
  mockVideoPlayer.mounted = false;
  mockAudioPlayer.play.mockClear();
  mockAudioPlayer.pause.mockClear();
  mockAudioPlayer.addListener.mockClear();
  jest.mocked(useVideoPlayer).mockClear();
});

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

test('one lazy video press creates and starts the player after its view attaches', () => {
  const mockUseVideoPlayer = jest.mocked(useVideoPlayer);
  mockUseVideoPlayer.mockClear();

  const view = render(
    <NoteBlockRenderer
      lazyMedia
      blocks={[{ type: 'video', props: { url: 'https://cdn.example/preview.mp4' } }]}
    />,
  );

  expect(mockUseVideoPlayer).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Play video' }));
  expect(mockUseVideoPlayer).toHaveBeenCalledTimes(1);
  expect(mockUseVideoPlayer).toHaveBeenCalledWith(
    'https://cdn.example/preview.mp4',
    expect.any(Function),
  );
  expect(mockVideoPlayer.play).toHaveBeenCalledTimes(1);
  view.rerender(<NoteBlockRenderer lazyMedia blocks={[{ type: 'video', props: { url: 'https://cdn.example/preview.mp4' } }]} />);
  expect(mockVideoPlayer.play).toHaveBeenCalledTimes(1);
});

test('normal video details attach controls without automatically playing', () => {
  render(<NoteBlockRenderer blocks={[{ type: 'video', props: { url: 'https://cdn.example/detail.mp4' } }]} />);
  expect(mockVideoPlayer.mounted).toBe(true);
  expect(mockVideoPlayer.play).not.toHaveBeenCalled();
});

test('one press starts a lazy audio player', () => {
  mockAudioPlayer.play.mockClear();
  render(<NoteBlockRenderer lazyMedia blocks={[{ type: 'audio', props: { url: 'https://cdn.example/audio.webm' } }]} />);
  expect(mockAudioPlayer.play).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Play recording' }));
  expect(mockAudioPlayer.play).toHaveBeenCalledTimes(1);
});

test.each([
  ['en', 'Play video', 'Play recording', 'Pause recording', 'View image'],
  ['zh', '播放视频', '播放录音', '暂停录音', '查看图片'],
])('media accessibility labels follow %s, including active recording pause', (language, video, play, pause, image) => {
  mockLanguage = language;
  render(<NoteBlockRenderer lazyMedia onImagePress={jest.fn()} blocks={[
    { type: 'video', props: { url: 'https://cdn.example/video.mp4' } },
    { type: 'audio', props: { url: 'https://cdn.example/audio.webm' } },
    { type: 'image', props: { url: 'https://cdn.example/image.jpg' } },
    { type: 'image', props: { url: 'https://cdn.example/captioned.jpg', caption: 'My caption' } },
  ]} />);
  expect(screen.getByRole('button', { name: video })).toBeTruthy();
  expect(screen.getByRole('imagebutton', { name: image })).toBeTruthy();
  expect(screen.getByRole('imagebutton', { name: 'My caption' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: play }));
  const listener = mockAudioPlayer.addListener.mock.calls[0][1];
  act(() => listener({ playing: true, isLoaded: true, currentTime: 2, duration: 10 }));
  fireEvent.press(screen.getByRole('button', { name: pause }));
  expect(mockAudioPlayer.pause).toHaveBeenCalledTimes(1);
});

test('attached contact and group cards activate their destinations', () => {
  const contact = jest.fn(); const group = jest.fn();
  render(<NoteBlockRenderer onContactPress={contact} onGroupPress={group} blocks={[
    { type: 'contact', props: { id: 'friend-id', name: 'Friend' } },
    { type: 'group', props: { id: 'legacy-id', circleId: 'circle-id', name: 'Group' } },
  ]} />);
  fireEvent.press(screen.getByRole('button', { name: 'Friend' }));
  fireEvent.press(screen.getByRole('button', { name: 'Group' }));
  expect(contact).toHaveBeenCalledWith('friend-id', 'Friend');
  expect(group).toHaveBeenCalledWith('circle-id', 'Group');
});
