import { useRef, useState } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { useComposerInput } from './use-composer-input';
import type { MentionTarget } from '@/features/chat/utils/chat-send-payloads';

jest.mock('@/chat-core/api', () => ({ fetchChatMembers: jest.fn().mockResolvedValue([]) }));
jest.mock('@/chat-core/socket-manager', () => ({ sendChatTyping: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

function useInput(initialDraft: string) {
  const [draft, setDraft] = useState(initialDraft);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionPickerVisible, setMentionPickerVisible] = useState(false);
  const [mentionTargets, setMentionTargets] = useState<MentionTarget[]>([]);
  const [mentionCandidates, setMentionCandidates] = useState<MentionTarget[]>([]);
  const [, setGroupMemberNames] = useState<Record<string, string>>({});
  const input = useComposerInput({
    currentUserID: 'me', draft, setDraft, mentionQuery, setMentionQuery,
    setMentionPickerVisible, mentionCandidates, setMentionCandidates,
    mentionCandidatesCacheRef: useRef(new Map()),
    mentionCandidatesInflightRef: useRef(new Map()),
    setMentionTargets, setGroupMemberNames, mountedRef: useRef(true),
    sourceID: '', conversationID: 'c1', isGroupChat: true, canViewGroupMemberProfiles: true,
  });
  return { ...input, draft, mentionQuery, mentionPickerVisible, mentionTargets };
}

const select = (start: number, end = start) => ({ nativeEvent: { selection: { start, end } } });

test('typing @ in the middle opens the picker before the next selection event', () => {
  const { result } = renderHook(() => useInput('前后'));
  act(() => result.current.handleSelectionChange(select(1)));
  act(() => result.current.handleDraftChange('前@后'));
  expect(result.current.mentionQuery).toBe('');
  expect(result.current.mentionPickerVisible).toBe(true);
});

test('selection events read the latest native text in the same update', () => {
  const { result } = renderHook(() => useInput(''));
  act(() => {
    result.current.handleDraftChange('@');
    result.current.handleSelectionChange(select(1));
  });
  expect(result.current.mentionQuery).toBe('');
});

test('avatar insertion replaces the selection without deleting an earlier @ token', () => {
  const { result } = renderHook(() => useInput('@Old hello world'));
  act(() => result.current.handleSelectionChange(select(5, 10)));
  act(() => result.current.handleInsertMention({ userID: 'alice', nickname: 'Alice' }));
  expect(result.current.draft).toBe('@Old @Alice  world');
  expect(result.current.selection).toEqual({ start: 12, end: 12 });
  expect(result.current.mentionTargets).toEqual([{ userID: 'alice', nickname: 'Alice' }]);
});


test.each(['selection-first', 'text-first'])('repeated text keeps the native mid-token cursor with %s events', (order) => {
  const { result } = renderHook(() => useInput('@Ann'));
  act(() => result.current.handleSelectionChange(select(2)));
  act(() => {
    if (order === 'selection-first') result.current.handleSelectionChange(select(3));
    result.current.handleDraftChange('@Annn');
    if (order === 'text-first') result.current.handleSelectionChange(select(3));
  });
  expect(result.current.mentionQuery).toBe('An');
  act(() => result.current.handleInsertEmoji('😀'));
  expect(result.current.draft).toBe('@An😀nn');
});
