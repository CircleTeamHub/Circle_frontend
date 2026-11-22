import { useRef, useState } from 'react';
import { Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useComposerInput } from './use-composer-input';
import type { MentionTarget } from '@/features/chat/utils/chat-send-payloads';

jest.mock('@/chat-core/api', () => ({ fetchChatMembers: jest.fn().mockResolvedValue([]) }));
jest.mock('@/chat-core/socket-manager', () => ({ sendChatTyping: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

function useInput(initialDraft: string, inputRef?: { current: { focus: () => void } | null }) {
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
    inputRef: inputRef as never,
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

describe('on web, where typing fires no selection events', () => {
  // react-native-web 只在选中一段文字时才发 onSelectionChange，单纯打字不发。
  // 以前光标一直记成 0：@ 选人插到开头、原来的「@」留在原处，表情也插到开头。
  let restore: { restore: () => void };
  beforeEach(() => { restore = jest.replaceProperty(Platform, 'OS', 'web'); });
  afterEach(() => restore.restore());

  test('a picked mention replaces the typed @ instead of landing at the start', () => {
    const { result } = renderHook(() => useInput(''));
    act(() => result.current.handleDraftChange('周末@'));
    expect(result.current.mentionPickerVisible).toBe(true);
    act(() => result.current.handlePickMention({ userID: 'bob', nickname: 'Bob' }));
    expect(result.current.draft).toBe('周末@Bob ');
    expect(result.current.selection).toEqual({ start: 7, end: 7 });
  });

  test('picking a mention hands focus straight back to the composer', () => {
    // 点选人列表会让网页输入框失焦，手机网页键盘直接收起，接着打的字也进不了输入框。
    const focus = jest.fn();
    const { result } = renderHook(() => useInput('', { current: { focus } }));
    act(() => result.current.handleDraftChange('@'));
    act(() => result.current.handlePickMention({ userID: 'bob', nickname: 'Bob' }));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  test('an emoji goes where the user is typing, not at the start', () => {
    const { result } = renderHook(() => useInput(''));
    act(() => result.current.handleDraftChange('你好'));
    act(() => result.current.handleInsertEmoji('😀'));
    expect(result.current.draft).toBe('你好😀');
  });
});
