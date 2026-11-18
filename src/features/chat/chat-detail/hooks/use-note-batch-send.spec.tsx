import { startChatSend } from '@/chat-core/send-handle';
import { sendCardMessage, sendLocationMessage, sendVideoMessage } from '@/chat-core/client';
import { fetchNoteDetail, getCachedNoteDetail, importNoteChatMedia } from '@/services/api/notes';
import { showTopNotice } from '@/components/app/top-notice-store';
import { uploadChatVideoPoster } from '@/features/chat/utils/chat-video-poster';
import type { NoteCardData } from '@/types';
import { act, renderHook } from '@testing-library/react-native';
import type { NoteSummary } from '@/features/notes/types';
import { useAppDialogStore } from '@/components/app/app-dialog-store';
import { useNoteSectionSendStore } from '@/features/chat/store/use-note-section-send-store';
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
jest.mock('@/features/chat/utils/chat-video-poster', () => ({ uploadChatVideoPoster: jest.fn() }));
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
  jest.mocked(fetchNoteDetail).mockReset();
  useAppDialogStore.getState().reset();
  useNoteSectionSendStore.setState({ sending: {} });
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
const cardOnly = { card: true, showcase: false, location: false };

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
  ] as const)('the %s chip copies only that section straight away, without waiting for the note to load', async (section, expected) => {
    // 卡片上有视频:详情(截封面用)和拷贝同时拉;详情迟迟不回,拷贝也照样已经发出。
    jest.mocked(fetchNoteDetail).mockImplementationOnce(() => new Promise(() => {}));
    jest.mocked(importNoteChatMedia).mockResolvedValueOnce({ items: [] } as never);
    const hook = create('conversation-a');
    await act(async () => { await hook.result.current.handleSendNoteSection(card, section); });
    expect(importNoteChatMedia).toHaveBeenCalledWith('note-a', expected);
    expect(sendCardMessage).not.toHaveBeenCalled();
    // 进度显示在卡片标签上,不弹「正在发送…」。
    expect(showTopNotice).not.toHaveBeenCalled();
  });

  test('a note without videos is never loaded for a poster', async () => {
    jest.mocked(importNoteChatMedia).mockResolvedValueOnce({ items: [] } as never);
    const hook = create('conversation-a');
    await act(async () => {
      await hook.result.current.handleSendNoteSection({ ...card, videoCount: 0 }, 'showcase');
    });
    expect(fetchNoteDetail).not.toHaveBeenCalled();
    expect(importNoteChatMedia).toHaveBeenCalledWith('note-a', ['showcase']);
  });

  test('the chip shows as sending from the tap until the section has gone out', async () => {
    let resolveImport!: (value: unknown) => void;
    const pendingImport = new Promise((resolve) => { resolveImport = resolve; });
    jest.mocked(fetchNoteDetail).mockImplementationOnce(() => new Promise(() => {}));
    jest.mocked(importNoteChatMedia).mockImplementationOnce(() => pendingImport as never);
    const hook = create('conversation-a');
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.handleSendNoteSection(card, 'media'); });
    expect(useNoteSectionSendStore.getState().sending).toEqual({ 'note-a:media': 1 });
    await act(async () => {
      resolveImport({ items: [] });
      await pending;
    });
    expect(useNoteSectionSendStore.getState().sending).toEqual({});
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
    jest.mocked(fetchNoteDetail).mockImplementation(() => new Promise(() => {}));
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

  describe('videos copied from the note', () => {
    const copied = {
      items: [{ id: 'media-1', section: 'showcase', type: 'VIDEO', key: 'chat/me/note-import/abc.mp4', durationMs: 14000 }],
    };
    const withVideo = {
      ...note,
      media: [{ id: 'media-1', type: 'VIDEO', objectKey: 'notes/me/clip.mp4', url: 'https://cdn.test/notes/clip.mp4?sig=1' }],
    };
    const send = async (setSendError = jest.fn()) => {
      const hook = renderHook(() => useNoteBatchSend({
        t: ((key: string) => key) as never,
        authUser: null,
        setSendError,
        mountedRef: { current: true },
        sourceID: 'source-a',
        conversationID: 'conversation-a',
        isPreviewMode: false,
      }));
      await act(async () => { await hook.result.current.handleSendNoteSection(card, 'showcase'); });
    };

    // 服务端拷贝不带封面,不现截一帧的话气泡就是一块黑。
    test('get a poster captured from the note\'s own copy of the video', async () => {
      jest.mocked(importNoteChatMedia).mockResolvedValueOnce(copied as never);
      jest.mocked(fetchNoteDetail).mockResolvedValueOnce(withVideo as never);
      // In time, the before-upload check lets the poster through.
      jest.mocked(uploadChatVideoPoster).mockImplementationOnce(async (...args) => {
        args[4]?.();
        return { key: 'chat/me/poster-abc.jpg' };
      });
      await send();
      expect(fetchNoteDetail).toHaveBeenCalledTimes(1);
      expect(uploadChatVideoPoster).toHaveBeenCalledWith(
        'https://cdn.test/notes/clip.mp4?sig=1',
        14,
        'abc.mp4',
        'chat',
        expect.any(Function),
      );
      expect(sendVideoMessage).toHaveBeenCalledWith(expect.objectContaining({
        key: 'chat/me/note-import/abc.mp4',
        thumbKey: 'chat/me/poster-abc.jpg',
      }));
    });

    test('still go out, just without a poster, when the note cannot be loaded', async () => {
      jest.mocked(importNoteChatMedia).mockResolvedValueOnce(copied as never);
      jest.mocked(fetchNoteDetail).mockRejectedValueOnce(new Error('offline'));
      const setSendError = jest.fn();
      await send(setSendError);
      expect(uploadChatVideoPoster).not.toHaveBeenCalled();
      expect(sendVideoMessage).toHaveBeenCalledWith(expect.objectContaining({
        key: 'chat/me/note-import/abc.mp4',
        thumbKey: undefined,
      }));
      expect(setSendError).not.toHaveBeenCalled();
    });

    test('a poster capture that hangs on a large video does not hold the video back', async () => {
      jest.useFakeTimers();
      try {
        jest.mocked(importNoteChatMedia).mockResolvedValueOnce(copied as never);
        jest.mocked(fetchNoteDetail).mockResolvedValueOnce(withVideo as never);
        jest.mocked(uploadChatVideoPoster).mockImplementationOnce(() => new Promise(() => {}));
        const hook = create('conversation-a');
        let pending!: Promise<void>;
        act(() => { pending = hook.result.current.handleSendNoteSection(card, 'showcase'); });
        await act(async () => { await jest.advanceTimersByTimeAsync(9_000); });
        expect(sendVideoMessage).not.toHaveBeenCalled();
        await act(async () => {
          await jest.advanceTimersByTimeAsync(1_500);
          await pending;
        });
        expect(sendVideoMessage).toHaveBeenCalledWith(expect.objectContaining({
          key: 'chat/me/note-import/abc.mp4',
          thumbKey: undefined,
        }));
      } finally {
        jest.useRealTimers();
      }
    });

    // The capture is not cancelled by the timeout. If it finishes later, its upload must be
    // refused, or an orphan poster lands in chat/ that no message points at.
    test('a poster capture that finishes after the timeout is not uploaded', async () => {
      jest.useFakeTimers();
      try {
        jest.mocked(importNoteChatMedia).mockResolvedValueOnce(copied as never);
        jest.mocked(fetchNoteDetail).mockResolvedValueOnce(withVideo as never);
        let beforeUpload: (() => void) | undefined;
        jest.mocked(uploadChatVideoPoster).mockImplementationOnce((...args) => {
          beforeUpload = args[4];
          return new Promise(() => {});
        });
        const hook = create('conversation-a');
        let pending!: Promise<void>;
        act(() => { pending = hook.result.current.handleSendNoteSection(card, 'showcase'); });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(10_500);
          await pending;
        });
        expect(sendVideoMessage).toHaveBeenCalledWith(expect.objectContaining({ thumbKey: undefined }));
        expect(() => beforeUpload?.()).toThrow();
      } finally {
        jest.useRealTimers();
      }
    });

    test('still go out without a poster when no frame can be captured', async () => {
      jest.mocked(importNoteChatMedia).mockResolvedValueOnce(copied as never);
      jest.mocked(fetchNoteDetail).mockResolvedValueOnce(withVideo as never);
      jest.mocked(uploadChatVideoPoster).mockResolvedValueOnce(null);
      await send();
      expect(sendVideoMessage).toHaveBeenCalledWith(expect.objectContaining({ thumbKey: undefined }));
    });
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
