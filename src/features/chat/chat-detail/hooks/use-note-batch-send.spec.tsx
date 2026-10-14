import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { NoteSummary } from '@/features/notes/types';
import {
  dismissDialog,
  useAppDialogStore,
} from '@/components/app/app-dialog-store';
import { useNoteBatchSend } from './use-note-batch-send';

const mockWithFreshNoteSourceStatus = jest.fn();

jest.mock('@/features/chat/utils/note-card-fresh-status', () => ({
  withFreshNoteSourceStatus: (...args: unknown[]) =>
    mockWithFreshNoteSourceStatus(...args),
}));
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
jest.mock('@/chat-core/send-errors', () => ({
  getChatSendErrorMessage: jest.fn(),
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
  mockWithFreshNoteSourceStatus.mockReset();
  useAppDialogStore.getState().reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('queued status refresh does not show a warning after the chat unmounts', async () => {
  let resolveFresh!: (value: unknown[]) => void;
  mockWithFreshNoteSourceStatus.mockReturnValue(
    new Promise((resolve) => {
      resolveFresh = resolve;
    }),
  );
  const mountedRef = { current: true };
  const hook = renderHook(() =>
    useNoteBatchSend({
      t: ((key: string) => key) as never,
      authUser: null,
      setSendError: jest.fn(),
      mountedRef,
      sourceID: 'source-a',
      conversationID: 'conversation-a',
      isPreviewMode: false,
    }),
  );

  let run!: Promise<void>;
  act(() => {
    run = hook.result.current.handlePickNoteBatch([note], {
      card: false,
      media: false,
      showcase: false,
      location: false,
    });
  });
  await waitFor(() => expect(mockWithFreshNoteSourceStatus).toHaveBeenCalled());

  mountedRef.current = false;
  hook.unmount();
  await act(async () => {
    resolveFresh([
      {
        noteId: 'note-a',
        workStatus: 'CLOSED',
        publicationStatus: 'ACTIVE',
      },
    ]);
    await run;
  });

  expect(useAppDialogStore.getState().queue).toHaveLength(0);
});

test('a second warning waits for the first dialog to be removed', async () => {
  mockWithFreshNoteSourceStatus.mockImplementation(async (cards: unknown[]) =>
    cards.map((card) => ({
      ...(card as object),
      workStatus: 'CLOSED',
      publicationStatus: 'ACTIVE',
    })),
  );
  const hook = renderHook(() =>
    useNoteBatchSend({
      t: ((key: string) => key) as never,
      authUser: null,
      setSendError: jest.fn(),
      mountedRef: { current: true },
      sourceID: 'source-a',
      conversationID: 'conversation-a',
      isPreviewMode: false,
    }),
  );
  const options = { card: false, media: false, showcase: false, location: false };
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = hook.result.current.handlePickNoteBatch([note], options);
    second = hook.result.current.handlePickNoteBatch([note], options);
  });
  await waitFor(() => expect(useAppDialogStore.getState().queue).toHaveLength(1));
  const firstDialog = useAppDialogStore.getState().queue[0];

  let firstSettled = false;
  void first.then(() => {
    firstSettled = true;
  });
  act(() => {
    firstDialog.buttons?.find((button) => button.style === 'cancel')?.onPress?.();
  });
  await Promise.resolve();
  expect(firstSettled).toBe(false);

  act(() => {
    dismissDialog(firstDialog.id);
  });
  await first;
  await waitFor(() => {
    const [next] = useAppDialogStore.getState().queue;
    expect(next?.id).toBeDefined();
    expect(next?.id).not.toBe(firstDialog.id);
  });

  const secondDialog = useAppDialogStore.getState().queue[0];
  act(() => {
    secondDialog.buttons?.find((button) => button.style === 'cancel')?.onPress?.();
    dismissDialog(secondDialog.id);
  });
  await second;
});


test('two mounted hooks sharing a deduplicated warning both settle their queues', async () => {
  mockWithFreshNoteSourceStatus.mockImplementation(async (cards: unknown[]) => cards.map(card => ({ ...(card as object), workStatus: 'CLOSED', publicationStatus: 'ACTIVE' })));
  const create = () => renderHook(() => useNoteBatchSend({ t: ((key: string) => key) as never, authUser: null, setSendError: jest.fn(), mountedRef: { current: true }, sourceID: 's', conversationID: 'c', isPreviewMode: false }));
  const first = create(); const second = create();
  const options = { card: false, media: false, showcase: false, location: false };
  let a!: Promise<void>; let b!: Promise<void>;
  act(() => { a = first.result.current.handlePickNoteBatch([note], options); b = second.result.current.handlePickNoteBatch([note], options); });
  await waitFor(() => expect(mockWithFreshNoteSourceStatus).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(useAppDialogStore.getState().queue).toHaveLength(1));
  act(() => dismissDialog(useAppDialogStore.getState().queue[0].id));
  await act(async () => { await Promise.all([a, b]); });
  expect(useAppDialogStore.getState().queue).toHaveLength(0);
});
