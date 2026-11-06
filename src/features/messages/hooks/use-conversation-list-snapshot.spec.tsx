import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useConversationListSnapshot } from './use-conversation-list-snapshot';

const mockWritePageSnapshot = jest.fn();
jest.mock('@/storage/page-snapshots', () => ({
  getPageSnapshotRevision: () => 0,
  readPageSnapshot: () => null,
  writePageSnapshot: (...args: unknown[]) => mockWritePageSnapshot(...args),
}));
jest.mock('@/chat-core/mappers', () => ({
  mapChatConversationToUI: (row: { id: string }) => ({ id: row.id, message: 'x' }),
}));

type Listener = (state: Record<string, unknown>, previous: Record<string, unknown>) => void;
const mockChat = {
  state: { currentUserId: 'u1', conversationsSnapshotLoaded: true, conversations: [{ id: 'c0' }] } as Record<string, unknown>,
  listeners: new Set<Listener>(),
};
jest.mock('@/chat-core/store', () => {
  const useChatStore = (selector: (state: Record<string, unknown>) => unknown) => selector(mockChat.state);
  useChatStore.getState = () => mockChat.state;
  useChatStore.subscribe = (listener: Listener) => {
    mockChat.listeners.add(listener);
    return () => mockChat.listeners.delete(listener);
  };
  return { useChatStore };
});
jest.mock('@/stores/authStore', () => {
  const state = { user: { id: 'u1' }, sessionEpoch: 1 };
  const useAuthStore = (selector: (s: typeof state) => unknown) => selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

function pushConversations(n: number) {
  const previous = mockChat.state;
  mockChat.state = { ...previous, conversations: [{ id: `c${n}` }] };
  mockChat.listeners.forEach((listener) => listener(mockChat.state, previous));
}

describe('useConversationListSnapshot', () => {
  let appStateListener: ((state: string) => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWritePageSnapshot.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove: jest.fn() } as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('writes at most once per throttle window while messages keep arriving', () => {
    renderHook(() => useConversationListSnapshot([], true));
    for (let i = 1; i <= 40; i += 1) {
      act(() => {
        pushConversations(i);
        jest.advanceTimersByTime(500);
      });
    }
    // 40 updates over 20s: still inside the first window.
    expect(mockWritePageSnapshot).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(mockWritePageSnapshot).toHaveBeenCalledTimes(1);
    expect(mockWritePageSnapshot.mock.calls[0][2]).toEqual([{ id: 'c40', message: '', draftPreview: undefined }]);
  });

  it('flushes immediately when the app goes to the background', () => {
    renderHook(() => useConversationListSnapshot([], true));
    act(() => {
      pushConversations(1);
      appStateListener?.('background');
    });
    expect(mockWritePageSnapshot).toHaveBeenCalledTimes(1);
  });
});
