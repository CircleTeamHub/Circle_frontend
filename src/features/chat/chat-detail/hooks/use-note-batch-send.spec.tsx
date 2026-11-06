import { startChatSend } from '@/chat-core/send-handle';
import { sendCardMessage, sendLocationMessage } from '@/chat-core/client';
import { fetchNoteDetail, importNoteChatMedia } from '@/services/api/notes';
import { act, renderHook } from '@testing-library/react-native';
import type { NoteSummary } from '@/features/notes/types';
import { useAppDialogStore } from '@/components/app/app-dialog-store';
import { useNoteBatchSend } from './use-note-batch-send';

jest.mock('@/services/api/notes', () => ({
  fetchNoteDetail: jest.fn(),
  importNoteChatMedia: jest.fn(),
}));
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
  const detail = { ...note, mediaCount: 2, hasLocation: true };

  test.each([
    ['media', ['media']],
    ['showcase', ['showcase']],
  ] as const)('the %s chip copies only that section and sends no card', async (section, expected) => {
    jest.mocked(fetchNoteDetail).mockResolvedValueOnce(detail as never);
    jest.mocked(importNoteChatMedia).mockResolvedValueOnce({ items: [] } as never);
    const hook = create('conversation-a');
    await act(async () => { await hook.result.current.handleSendNoteSection('note-a', section); });
    expect(fetchNoteDetail).toHaveBeenCalledWith('note-a');
    expect(importNoteChatMedia).toHaveBeenCalledWith('note-a', expected);
    expect(sendCardMessage).not.toHaveBeenCalled();
  });

  test('the location chip sends the note location as my message', async () => {
    jest.mocked(fetchNoteDetail).mockResolvedValueOnce({
      ...detail,
      sections: { location: { latitude: 31.2, longitude: 121.4, title: '静安', address: '上海' } },
    } as never);
    const hook = create('conversation-a');
    await act(async () => { await hook.result.current.handleSendNoteSection('note-a', 'location'); });
    expect(importNoteChatMedia).not.toHaveBeenCalled();
    expect(sendLocationMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation-a' }));
    expect(sendCardMessage).not.toHaveBeenCalled();
  });

  test('tapping the same chip again while it is still sending sends it only once', async () => {
    let resolveDetail!: (value: unknown) => void;
    const pendingDetail = new Promise((resolve) => { resolveDetail = resolve; });
    jest.mocked(fetchNoteDetail).mockImplementationOnce(() => pendingDetail as never);
    jest.mocked(importNoteChatMedia).mockResolvedValue({ items: [] } as never);
    const hook = create('conversation-a');
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = hook.result.current.handleSendNoteSection('note-a', 'media');
      second = hook.result.current.handleSendNoteSection('note-a', 'media');
    });
    await act(async () => {
      resolveDetail(detail);
      await Promise.all([first, second]);
    });
    expect(fetchNoteDetail).toHaveBeenCalledTimes(1);
    expect(importNoteChatMedia).toHaveBeenCalledTimes(1);

    // 发完之后再点是一次新的发送。
    jest.mocked(fetchNoteDetail).mockResolvedValueOnce(detail as never);
    await act(async () => { await hook.result.current.handleSendNoteSection('note-a', 'media'); });
    expect(fetchNoteDetail).toHaveBeenCalledTimes(2);
  });

  test('a note that cannot be loaded reports a send error and sends nothing', async () => {
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
    await act(async () => { await hook.result.current.handleSendNoteSection('note-a', 'media'); });
    expect(setSendError).toHaveBeenCalled();
    expect(sendCardMessage).not.toHaveBeenCalled();
    expect(sendLocationMessage).not.toHaveBeenCalled();
  });
});
