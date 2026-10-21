import { act, renderHook } from '@testing-library/react-native';
import { useChatStore } from '@/chat-core/store';
import { readComposerDraft } from '@/chat-core/composer-drafts';
import { useComposerDraftPersistence } from './use-composer-draft';

const mockDraftState = {
  saveDraft: jest.fn(),
  clearDraft: jest.fn(),
};

jest.mock('@/chat-core/store', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    useChatStore: create(() => ({ conversations: [] })),
  };
});

jest.mock('@/chat-core/composer-drafts', () => ({
  readComposerDraft: jest.fn(),
  useComposerDraftStore: {
    getState: () => mockDraftState,
  },
}));

const mockReadComposerDraft = jest.mocked(readComposerDraft);
const mockUseChatStore = useChatStore as typeof useChatStore & {
  setState: (state: { conversations: { id: string; textEncryption?: string }[] }) => void;
};

const savedDraft = {
  text: '本地明文草稿',
  quoteMessageId: null,
  mentions: [],
  updatedAt: 1,
};

function conversation(textEncryption?: string) {
  return textEncryption === undefined
    ? { id: 'conversation-1' }
    : { id: 'conversation-1', textEncryption };
}

function renderDraft(initialDraft = '') {
  const setDraft = jest.fn();
  const setMentionTargets = jest.fn();
  const setQuoteTarget = jest.fn();
  const result = renderHook(
    ({ draft }: { draft: string }) =>
      useComposerDraftPersistence({
        userId: 'user-1',
        conversationId: 'conversation-1',
        draft,
        setDraft,
        mentionTargets: [],
        setMentionTargets,
        quoteTarget: null,
        setQuoteTarget,
        messages: [],
        paused: false,
      }),
    { initialProps: { draft: initialDraft } },
  );
  return { ...result, setDraft, setMentionTargets, setQuoteTarget };
}

describe('useComposerDraftPersistence encryption-mode gate', () => {
  const originalE2eeFlag = process.env.EXPO_PUBLIC_E2EE_TEXT_ENABLED;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    delete process.env.EXPO_PUBLIC_E2EE_TEXT_ENABLED;
    mockReadComposerDraft.mockReturnValue(savedDraft);
    mockUseChatStore.setState({ conversations: [] });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    if (originalE2eeFlag === undefined) {
      delete process.env.EXPO_PUBLIC_E2EE_TEXT_ENABLED;
    } else {
      process.env.EXPO_PUBLIC_E2EE_TEXT_ENABLED = originalE2eeFlag;
    }
  });

  it.each([
    ['an absent conversation', []],
    ['an undefined mode', [conversation()]],
    ['an unsupported mode', [conversation('FUTURE_V2')]],
  ])('does not restore or persist while mode is unknown: %s', (_label, conversations) => {
    mockUseChatStore.setState({ conversations });
    const { rerender, unmount, setDraft } = renderDraft();

    expect(mockReadComposerDraft).not.toHaveBeenCalled();
    expect(setDraft).not.toHaveBeenCalled();

    rerender({ draft: '内存里的新内容' });
    act(() => jest.advanceTimersByTime(400));
    unmount();

    expect(mockDraftState.saveDraft).not.toHaveBeenCalled();
    expect(mockDraftState.clearDraft).not.toHaveBeenCalled();
  });

  it('restores and starts persistence only after unknown becomes explicit PLAIN', () => {
    const { rerender, setDraft } = renderDraft();
    expect(mockReadComposerDraft).not.toHaveBeenCalled();

    act(() => {
      mockUseChatStore.setState({
        conversations: [conversation('PLAIN')],
      });
    });

    expect(mockReadComposerDraft).toHaveBeenCalledTimes(1);
    expect(setDraft).toHaveBeenCalledWith('本地明文草稿');

    rerender({ draft: '更新后的草稿' });
    act(() => jest.advanceTimersByTime(400));

    expect(mockDraftState.saveDraft).toHaveBeenCalledWith(
      'user-1',
      'conversation-1',
      expect.objectContaining({ text: '更新后的草稿' }),
    );
  });

  it('never restores plaintext and clears it when unknown becomes MLS_V1', () => {
    const { setDraft } = renderDraft();
    expect(mockReadComposerDraft).not.toHaveBeenCalled();

    act(() => {
      mockUseChatStore.setState({
        conversations: [conversation('MLS_V1')],
      });
    });

    expect(mockReadComposerDraft).not.toHaveBeenCalled();
    expect(setDraft).not.toHaveBeenCalled();
    expect(mockDraftState.clearDraft).toHaveBeenCalledWith(
      'user-1',
      'conversation-1',
    );
    expect(mockDraftState.saveDraft).not.toHaveBeenCalled();
  });

  it('keeps the global E2EE compatibility flag from persisting a PLAIN draft', () => {
    process.env.EXPO_PUBLIC_E2EE_TEXT_ENABLED = 'true';
    mockUseChatStore.setState({
      conversations: [conversation('PLAIN')],
    });
    const { rerender } = renderDraft();

    expect(mockReadComposerDraft).toHaveBeenCalledTimes(1);
    rerender({ draft: '不应持久化' });
    act(() => jest.advanceTimersByTime(400));

    expect(mockDraftState.saveDraft).not.toHaveBeenCalled();
  });
});
