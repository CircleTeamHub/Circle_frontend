import { startChatSend } from '@/chat-core/send-handle';
import { sendCardMessage, sendLocationMessage } from '@/chat-core/client';
import { fetchNoteDetail, getCachedNoteDetail, importNoteChatMedia } from '@/services/api/notes';
import { showTopNotice } from '@/components/app/top-notice-store';
import type { NoteCardData } from '@/types';
import { act, renderHook } from '@testing-library/react-native';
import type { NoteSummary } from '@/features/notes/types';
import { useAppDialogStore } from '@/components/app/app-dialog-store';
import { useNoteBatchSend } from './use-note-batch-send';

jest.mock('@/services/api/notes', () => ({
  fetchNoteDetail: jest.fn(),
  getCachedNoteDetail: jest.fn(() => null),
  importNoteChatMedia: jest.fn(),
}));
jest.mock('@/components/app/top-notice-store', () => ({ showTopNotice: jest.fn() }));
jest.mock('@/chat-core/client', () => ({
  sendCardMessage: jest.fn(),
  sendImageMessage: jest.fn(),
  sendLocationMessage: jest.fn(),
  sendVideoMessage: jest.fn(),
}));
jest.mock('@/chat-core/send-handle', () => ({
  startChatSend: jest.fn(),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/chat-core/send-errors', () => ({
  getChatSendErrorMessage: jest.fn((_error: unknown, fallback: string) => fallback),
  reportChatSendFailure: jest.fn(),
}));

const note: NoteSummary = {
  id: 'note-a',
  title: 'A',
  contentPreview: null,
  status: 'ACTIVE',
  available: true,
  pinned: false,
  groups: [],
  cover: null,
  imageCount: 0,
  videoCount: 0,
  mediaCount: 0,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(startChatSend).mockReset().mockImplementation(
    (send: (callback: () => void) => Promise<unknown>) => ({ queued: true, delivered: Promise.resolve(send(() => {})) }),
  );
  jest.mocked(sendCardMessage).mockReset().mockResolvedValue({} as never);
  useAppDialogStore.getState().reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const create = (conversationID: string) => renderHook(() => useNoteBatchSend({
  t: ((key: string) => key) as never,
  authUser: null,
  setSendError: jest.fn(),
  mountedRef: { current: true },
  sourceID: conversationID,
  conversationID,
  isPreviewMode: false,
}));
const cardOnly = { card: true, media: false, showcase: false, location: false };

test('a closed or off-shelf note is sent straight away without a status warning', async () => {
  const hook = create('conversation-a');
  const closed: NoteSummary = { ...note, workStatus: 'CLOSED' };
  const offShelf: NoteSummary = { ...note, id: 'note-b', workStatus: 'OFF_SHELF' };
  await act(async () => {
    await hook.result.current.handlePickNoteBatch([closed, offShelf], cardOnly);
  });
  expect(useAppDialogStore.getState().queue).toHaveLength(0);
  expect(sendCardMessage).toHaveBeenCalledTimes(2);
  expect(sendCardMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation-a' }));
});

test('batches picked in two chats each send to their own conversation', async () => {
  const first = create('a');
  const second = create('b');
  let a!: Promise<void>;
  let b!: Promise<void>;
  act(() => {
    a = first.result.current.handlePickNoteBatch([note], cardOnly);
    b = second.result.current.handlePickNoteBatch([note], cardOnly);
  });
  await act(async () => { await Promise.all([a, b]); });
  expect(sendCardMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'a' }));
  expect(sendCardMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'b' }));
});

test('nothing is sent once the chat has gone away before the batch starts', async () => {
  const mountedRef = { current: false };
  const hook = renderHook(() => useNoteBatchSend({
    t: ((key: string) => key) as never,
    authUser: null,
    setSendError: jest.fn(),
    mountedRef,
    sourceID: 'source-a',
    conversationID: 'conversation-a',
    isPreviewMode: false,
  }));
  await act(async () => {
    await hook.result.current.handlePickNoteBatch([note], cardOnly);
  });
  expect(sendCardMessage).not.toHaveBeenCalled();
});

describe('handleSendNoteSection', () => {
  const card = { noteId: 'note-a', title: 'n', imageCount: 2, videoCount: 1 } as NoteCardData;
  const located = {
    ...note,
    sections: { location: { latitude: 31.2, longitude: 121.4, title: '静安', address: '上海' } },
  };

  test.each([
    ['media', ['media']],
    ['showcase', ['showcase']],
  ] as const)('the %s chip copies only that section straight away, without loading the note first', async (section, expected) => {
    jest.mocked(importNoteChatMedia).mockResolvedValueOnce({ items: [] } as never);
    const hook = create('conversation-a');
    await act(async () => { await hook.result.current.handleSendNoteSection(card, section); });
    expect(fetchNoteDetail).not.toHaveBeenCalled();
    expect(importNoteChatMedia).toHaveBeenCalledWith('note-a', expected);
    expect(sendCardMessage).not.toHaveBeenCalled();
    // 消息进队就出现在会话里:不再弹「正在发送…」。
    expect(showTopNotice).not.toHaveBeenCalled();
  });

  test('the location chip sends the note location as my message', async () => {
    jest.mocked(fetchNoteDetail).mockResolvedValueOnce(located as never);
    const hook = create('conversation-a');
    await act(async () => { await hook.result.current.handleSendNoteSection(card, 'location'); });
    expect(importNoteChatMedia).not.toHaveBeenCalled();
    expect(sendLocationMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-a', latitude: 31.2, longitude: 121.4,
    }));
    expect(sendCardMessage).not.toHaveBeenCalled();
  });

  test('the location chip uses the cached note when there is one', async () => {
    jest.mocked(getCachedNoteDetail).mockReturnValueOnce({ value: located, at: 1 } as never);
    const hook = create('conversation-a');
    await act(async () => { await hook.result.current.handleSendNoteSection(card, 'location'); });
    expect(fetchNoteDetail).not.toHaveBeenCalled();
    expect(sendLocationMessage).toHaveBeenCalledTimes(1);
  });

  test('a note whose location is an empty 0,0 placeholder sends nothing and says so', async () => {
    jest.mocked(fetchNoteDetail).mockResolvedValueOnce({
      ...note,
      sections: { location: { latitude: 0, longitude: 0 } },
    } as never);
    const setSendError = jest.fn();
    const hook = renderHook(() => useNoteBatchSend({
      t: ((key: string) => key) as never,
      authUser: null,
      setSendError,
      mountedRef: { current: true },
      sourceID: 'source-a',
      conversationID: 'conversation-a',
      isPreviewMode: false,
    }));
    await act(async () => { await hook.result.current.handleSendNoteSection(card, 'location'); });
    expect(sendLocationMessage).not.toHaveBeenCalled();
    expect(setSendError).toHaveBeenCalledWith('chat.noteCard.noLocation');
  });

  test('tapping the same chip again while it is still sending sends it only once', async () => {
    let resolveImport!: (value: unknown) => void;
    const pendingImport = new Promise((resolve) => { resolveImport = resolve; });
    jest.mocked(importNoteChatMedia).mockImplementationOnce(() => pendingImport as never);
    const hook = create('conversation-a');
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = hook.result.current.handleSendNoteSection(card, 'media');
      second = hook.result.current.handleSendNoteSection(card, 'media');
    });
    await act(async () => {
      resolveImport({ items: [] });
      await Promise.all([first, second]);
    });
    expect(importNoteChatMedia).toHaveBeenCalledTimes(1);

    // 发完之后再点是一次新的发送。
    jest.mocked(importNoteChatMedia).mockResolvedValueOnce({ items: [] } as never);
    await act(async () => { await hook.result.current.handleSendNoteSection(card, 'media'); });
    expect(importNoteChatMedia).toHaveBeenCalledTimes(2);
  });

  test('a note that cannot be loaded for its location reports a send error and sends nothing', async () => {
    jest.mocked(fetchNoteDetail).mockRejectedValueOnce(new Error('gone'));
    const setSendError = jest.fn();
    const hook = renderHook(() => useNoteBatchSend({
      t: ((key: string) => key) as never,
      authUser: null,
      setSendError,
      mountedRef: { current: true },
      sourceID: 'source-a',
      conversationID: 'conversation-a',
      isPreviewMode: false,
    }));
    await act(async () => { await hook.result.current.handleSendNoteSection(card, 'location'); });
    expect(setSendError).toHaveBeenCalled();
    expect(sendCardMessage).not.toHaveBeenCalled();
    expect(sendLocationMessage).not.toHaveBeenCalled();
  });
});
