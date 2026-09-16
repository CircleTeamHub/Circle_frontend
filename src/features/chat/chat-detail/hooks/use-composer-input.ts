import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AT_ALL_USER_ID,
  filterMentionCandidates,
  getActiveMentionQuery,
  getMentionsPresentInText,
  type MentionTarget,
} from '@/features/chat/utils/chat-send-payloads';
import { fetchChatMembers } from '@/chat-core/api';
import { MENTION_CANDIDATE_LIMIT } from '@/features/chat/chat-detail/constants';
import { groupMemberDisplayName } from '@/features/chat/group-member-display';
import { reportHandledFailure } from '@/observability/report-failure';
import { sendChatTyping } from '@/chat-core/socket-manager';

export interface ComposerInputParams {
  currentUserID: string | null;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  setMentionPickerVisible: Dispatch<SetStateAction<boolean>>;
  mentionQuery: string | null;
  setMentionQuery: Dispatch<SetStateAction<string | null>>;
  mentionCandidates: MentionTarget[];
  setMentionCandidates: Dispatch<SetStateAction<MentionTarget[]>>;
  mentionCandidatesCacheRef: RefObject<Map<string, MentionTarget[]>>;
  mentionCandidatesInflightRef: RefObject<Map<string, Promise<MentionTarget[]>>>;
  setMentionTargets: Dispatch<SetStateAction<MentionTarget[]>>;
  setGroupMemberNames: Dispatch<SetStateAction<Record<string, string>>>;
  mountedRef: RefObject<boolean>;
  sourceID: string;
  conversationID: string;
  isGroupChat: boolean;
  canViewGroupMemberProfiles: boolean;
}

/**
 * 输入框的编辑行为:按光标插入表情、跟踪选区、输入时上报「正在输入」,
 * 以及群聊 @ 提及(候选加载与缓存、按输入过滤、选中后插入)。
 */
export function useComposerInput({
  currentUserID,
  draft,
  setDraft,
  setMentionPickerVisible,
  mentionQuery,
  setMentionQuery,
  mentionCandidates,
  setMentionCandidates,
  mentionCandidatesCacheRef,
  mentionCandidatesInflightRef,
  setMentionTargets,
  setGroupMemberNames,
  mountedRef,
  sourceID,
  conversationID,
  isGroupChat,
  canViewGroupMemberProfiles,
}: ComposerInputParams) {
  // 记录输入框光标位置：表情面板按光标处插入，而不是一律拼到末尾。
  // 用 ref 持续跟踪、用 state 只在插入后短暂受控，避免长期受控干扰中文输入法。
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const [selection, setSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);
  const visibleMentionCandidates = useMemo(
    () => filterMentionCandidates(mentionCandidates, mentionQuery),
    [mentionCandidates, mentionQuery],
  );
  const allMentionTarget = useMemo<MentionTarget>(
    () => ({ userID: AT_ALL_USER_ID, nickname: '所有人', isAll: true }),
    [],
  );
  const handleInsertEmoji = useCallback((emoji: string) => {
    setDraft((prev) => {
      // 光标位置可能落在旧文本之外（异步态），夹紧到当前长度避免越界。
      const start = Math.min(selectionRef.current.start, prev.length);
      const end = Math.min(selectionRef.current.end, prev.length);
      const next = prev.slice(0, start) + emoji + prev.slice(end);
      const cursor = start + emoji.length;
      selectionRef.current = { start: cursor, end: cursor };
      setSelection({ start: cursor, end: cursor });
      return next;
    });
  }, [setDraft]);

  const handleSelectionChange = useCallback(
    (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
      const nextSelection = event.nativeEvent.selection;
      selectionRef.current = nextSelection;
      if (isGroupChat && canViewGroupMemberProfiles) {
        const activeQuery = getActiveMentionQuery(draft, nextSelection.start);
        setMentionQuery(activeQuery);
        if (activeQuery === null) {
          setMentionPickerVisible(false);
        } else {
          setMentionPickerVisible(true);
        }
      }
      // 插入后短暂受控把光标移到表情之后；用户再次移动光标时释放受控，交还输入法。
      setSelection((current) => (current ? undefined : current));
    },
    [canViewGroupMemberProfiles, draft, isGroupChat, setMentionPickerVisible, setMentionQuery],
  );

  const loadMentionCandidates = useCallback(async () => {
    if (!isGroupChat || !sourceID || !canViewGroupMemberProfiles) return;
    const cached = mentionCandidatesCacheRef.current.get(sourceID);
    if (cached) {
      setMentionCandidates([allMentionTarget, ...cached]);
      return;
    }

    let request = mentionCandidatesInflightRef.current.get(sourceID);
    if (!request) {
      request = fetchChatMembers(conversationID)
        .then((members) =>
          members
            .filter((member) => member.userId !== currentUserID)
            .slice(0, MENTION_CANDIDATE_LIMIT)
            .map((member) => ({
              userID: member.userId,
              // @ 出去的名字也用群昵称:群里认得的是这个。
              nickname: groupMemberDisplayName(member),
            })),
        )
        .then((candidates) => {
          mentionCandidatesCacheRef.current.set(sourceID, candidates);
          return candidates;
        })
        .finally(() => {
          mentionCandidatesInflightRef.current.delete(sourceID);
        });
      mentionCandidatesInflightRef.current.set(sourceID, request);
    }

    try {
      const candidates = await request;
      if (!mountedRef.current) return;
      setMentionCandidates([allMentionTarget, ...candidates]);
    } catch (error) {
      reportHandledFailure('chatDetail', 'loadMentionCandidates', error);
      if (mountedRef.current) setMentionCandidates([]);
    }
  }, [allMentionTarget, canViewGroupMemberProfiles, conversationID, currentUserID, isGroupChat, sourceID, mentionCandidatesCacheRef, mentionCandidatesInflightRef, mountedRef, setMentionCandidates]);

  // 群聊打开时拉一次成员表，建 senderID→昵称映射给发送者名字标签兜底。
  // 单聊不需要（气泡不显示发送者名字）。
  useEffect(() => {
    if (!isGroupChat || !sourceID || !canViewGroupMemberProfiles) {
      setGroupMemberNames({});
      return;
    }
    let cancelled = false;
    fetchChatMembers(conversationID)
      .then((members) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const member of members) {
          // 群昵称优先:群里所有人看到的就是它。我自己给这位好友起的备注
          // 优先级更高,但那条在 receivedDisplayName 里另接。
          const nickname = groupMemberDisplayName(member);
          if (nickname && nickname !== member.userId) map[member.userId] = nickname;
        }
        setGroupMemberNames(map);
      })
      .catch((error) => {
        reportHandledFailure('chatDetail', 'loadGroupMemberNames', error);
      });
    return () => {
      cancelled = true;
    };
  }, [canViewGroupMemberProfiles, conversationID, isGroupChat, sourceID, setGroupMemberNames]);

  const handleDraftChange = useCallback(
    (next: string) => {
      setDraft(next);
      // 「正在输入」上报:只在有内容时发(清空不算输入)。隐私页的单聊/群聊
      // 开关与节流(2s)都收在 socket-manager 的 sendChatTyping 里。
      if (next.length > 0) {
        sendChatTyping(conversationID, isGroupChat ? 'group' : 'direct');
      }
      setMentionTargets((current) => getMentionsPresentInText(next, current));
      if (!isGroupChat || !canViewGroupMemberProfiles) {
        setMentionQuery(null);
        setMentionPickerVisible(false);
        return;
      }
      const selectionStart = selectionRef.current.start;
      const inferredCursor =
        selectionStart === draft.length && next.length >= draft.length
          ? next.length
          : Math.min(selectionStart, next.length);
      const activeQuery = getActiveMentionQuery(next, inferredCursor);
      setMentionQuery(activeQuery);
      if (activeQuery !== null) {
        setMentionPickerVisible(true);
        void loadMentionCandidates();
      } else {
        setMentionPickerVisible(false);
      }
    },
    [
      canViewGroupMemberProfiles,
      conversationID,
      draft,
      isGroupChat,
      loadMentionCandidates,
      setDraft,
      setMentionPickerVisible,
      setMentionQuery,
      setMentionTargets,
    ],
  );

  const handlePickMention = useCallback((target: MentionTarget) => {
    setDraft((current) => {
      const cursor = Math.min(selectionRef.current.start, current.length);
      const beforeCursor = current.slice(0, cursor);
      const atIndex = beforeCursor.lastIndexOf('@');
      const insert = `@${target.nickname} `;
      const next =
        atIndex >= 0
          ? `${current.slice(0, atIndex)}${insert}${current.slice(cursor)}`
          : `${current}${insert}`;
      const nextCursor = (atIndex >= 0 ? atIndex : current.length) + insert.length;
      selectionRef.current = { start: nextCursor, end: nextCursor };
      setSelection({ start: nextCursor, end: nextCursor });
      return next;
    });
    setMentionTargets((current) => {
      if (current.some((item) => item.userID === target.userID)) return current;
      return [...current, target];
    });
    setMentionQuery(null);
    setMentionPickerVisible(false);
  }, [setDraft, setMentionPickerVisible, setMentionQuery, setMentionTargets]);

  return {
    selection,
    visibleMentionCandidates,
    handleInsertEmoji,
    handleSelectionChange,
    handleDraftChange,
    handlePickMention,
  };
}
