import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { type ChatMessage } from '@/types';
import { isLocalMessageId } from '@/chat-core/local-message-id';
import {
  buildCollectionInputFromMessage,
  buildNoteCollectSource,
} from '@/features/chat/utils/message-collection';
import { collectNote, fetchNoteGroups } from '@/services/api/notes';
import type { CollectNoteSource, NoteGroup } from '@/features/notes/types';
import {
  AddNoteToNotesSheet,
  type AddNoteToNotesSelection,
} from '@/features/notes/components/AddNoteToNotesSheet';
import { Alert, Keyboard } from 'react-native';
import { router } from 'expo-router';
import { reportHandledFailure } from '@/observability/report-failure';
import { getApiErrorMessage } from '@/services/api/errors';
import { useChatStore } from '@/chat-core/store';
import { useAuthStore } from '@/stores/authStore';
import { createCollection } from '@/services/api/collections';
import { type TFunction } from 'i18next';
import { useNoteListSignalStore } from '@/features/notes/store/use-note-list-signal-store';

/**
 * React Native Modal measures its iOS host window when it is presented. If the
 * chat composer still has an active IME inset at that exact moment, the new
 * window can keep the shortened height even after Keyboard.dismiss() finishes.
 * Wait for the hide notification before mounting the modal so its first layout
 * is the real full-screen height.
 */
function waitForKeyboardToHide() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    let settled = false;
    let willHide: { remove: () => void } | undefined;
    let didHide: { remove: () => void } | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    finish = () => {
      if (settled) return;
      settled = true;
      willHide?.remove();
      didHide?.remove();
      if (timeout) clearTimeout(timeout);
      resolve();
    };
    if (Keyboard.isVisible()) {
      willHide = Keyboard.addListener('keyboardWillHide', finish);
      didHide = Keyboard.addListener('keyboardDidHide', finish);
      timeout = setTimeout(finish, 450);
    } else {
      timeout = setTimeout(finish, 32);
    }
  });
  return { promise, cancel: finish };
}

export type CollectMessageResult = 'collected' | 'skipped' | 'failed' | 'cancelled' | 'pending';

type CollectionContext = {
  epoch: number;
  conversationID: string;
  currentUserID: string | null;
};

type NoteCollectTarget = {
  noteId: string;
  noteTitle: string;
  source: CollectNoteSource;
};

type NoteCollectRequest = CollectionContext & {
  target: NoteCollectTarget;
  silent: boolean;
  saving: boolean;
  resolve?: (result: CollectMessageResult) => void;
  cancelKeyboard?: () => void;
};

export interface CollectMessageParams {
  t: TFunction<"translation", undefined>;
  currentUserID: string | null;
  sourceID: string;
  conversationID: string;
  isGroupChat: boolean;
  conversationTitle: string;
  avatarUrl: string | undefined;
  selfAvatarUri: string | undefined;
  selfName: string | undefined;
  selfUsername?: string;
}

/**
 * 长按菜单的「收藏」:普通消息进收藏列表(自己发的语音连 object key 一起存,才能重发),
 * 笔记卡片则快照复制进「我的笔记」并带上来源名片。
 */
export function useCollectMessage({
  t,
  currentUserID,
  sourceID,
  conversationID,
  isGroupChat,
  conversationTitle,
  avatarUrl,
  selfAvatarUri,
  selfName,
  selfUsername,
}: CollectMessageParams) {
  const [noteGroups, setNoteGroups] = useState<NoteGroup[]>([]);
  const [noteGroupsLoading, setNoteGroupsLoading] = useState(false);
  const [noteGroupsError, setNoteGroupsError] = useState<string | null>(null);
  const [noteCollectTarget, setNoteCollectTarget] = useState<NoteCollectTarget | null>(null);
  const [noteCollectOpening, setNoteCollectOpening] = useState(false);
  const [noteCollectSaving, setNoteCollectSaving] = useState(false);
  const sessionEpoch = useAuthStore.getState().sessionEpoch;
  const mountedRef = useRef(false);
  const contextRef = useRef({ conversationID, currentUserID });
  contextRef.current = { conversationID, currentUserID };
  const noteRequestRef = useRef<NoteCollectRequest | null>(null);

  const isCurrentContext = useCallback((context: CollectionContext) => (
    mountedRef.current &&
    useAuthStore.getState().sessionEpoch === context.epoch &&
    contextRef.current.conversationID === context.conversationID &&
    contextRef.current.currentUserID === context.currentUserID &&
    useChatStore.getState().activeConversationId === context.conversationID
  ), []);

  const finishNoteCollect = useCallback((result: CollectMessageResult) => {
    const request = noteRequestRef.current;
    noteRequestRef.current = null;
    request?.cancelKeyboard?.();
    request?.resolve?.(result);
    if (!mountedRef.current) return;
    setNoteCollectOpening(false);
    setNoteCollectTarget(null);
    setNoteCollectSaving(false);
    setNoteGroups([]);
    setNoteGroupsLoading(false);
    setNoteGroupsError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    finishNoteCollect('cancelled');
    const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      if (state.sessionEpoch !== previous.sessionEpoch) finishNoteCollect('cancelled');
    });
    const unsubscribeChat = useChatStore.subscribe((state, previous) => {
      if (state.activeConversationId !== previous.activeConversationId && state.activeConversationId !== conversationID) {
        finishNoteCollect('cancelled');
      }
    });
    return () => {
      mountedRef.current = false;
      unsubscribeAuth();
      unsubscribeChat();
      finishNoteCollect('cancelled');
    };
  }, [conversationID, currentUserID, finishNoteCollect]);

  const loadNoteGroups = useCallback(async () => {
    const request = noteRequestRef.current;
    if (!request || !isCurrentContext(request)) return;
    setNoteGroupsLoading(true);
    setNoteGroupsError(null);
    try {
      const groups = await fetchNoteGroups();
      if (noteRequestRef.current === request && isCurrentContext(request)) setNoteGroups(groups);
    } catch (error) {
      reportHandledFailure('noteGroups', 'fetchForCollection', error);
      if (noteRequestRef.current === request && isCurrentContext(request)) {
        setNoteGroupsError(getApiErrorMessage(error, '笔记分组加载失败，请重试。'));
      }
    } finally {
      if (noteRequestRef.current === request && isCurrentContext(request)) setNoteGroupsLoading(false);
    }
  }, [isCurrentContext]);

  const handleCollectMessage = useCallback(
    async (message: ChatMessage, options?: { silent?: boolean }): Promise<CollectMessageResult> => {
      if (!conversationID) return 'skipped';
      const context: CollectionContext = {
        epoch: sessionEpoch,
        conversationID,
        currentUserID,
      };
      if (!isCurrentContext(context)) return 'cancelled';
      // 还没拿到 ack 的气泡手上只有 local:<d>,服务端那条消息还不存在 ——
      // 收藏接口会按 COLLECTION_INVALID_MESSAGE_SOURCE 拒掉它。菜单已经不给入口,
      // 这里是兜底(长按菜单与发送 ack 之间存在竞态)。
      if (isLocalMessageId(message.id)) return 'skipped';

      // 笔记卡片：不进「收藏」列表，直接快照复制进「我的笔记」，
      // 并带上来源名片（群/用户）+ 消息定位信息，详情页可一键跳回聊天。
      if (message.type === 'note-card') {
        if (!message.noteCard) return 'skipped';

        // 笔记的 owner 是原笔记行的归属人。自己的笔记已经在「我的笔记」
        // 里，后端也会按这个规则原样返回它并忽略收藏标题/分组；这里提前拦截，
        // 避免给用户打开一个实际上不会保存的「编辑收藏标题」流程。
        if (currentUserID && message.noteCard.ownerId === currentUserID) {
          if (!options?.silent) {
            Alert.alert(t('chat.messageActions.noteOwnCannotCollect', {
              defaultValue: '不能收藏自己创建的笔记',
            }));
          }
          return 'skipped';
        }
        // A sheet owns its original message until confirmation or cancellation.
        if (noteRequestRef.current) return 'pending';

        const source = buildNoteCollectSource(message, {
          conversationID,
          conversationTitle,
          sourceID,
          conversationType: isGroupChat ? 'group' : 'private',
          conversationAvatarUrl: avatarUrl,
          currentUser: {
            id: currentUserID ?? undefined,
            name: selfName,
            faceURL: selfAvatarUri,
          },
        });
        if (!source) return 'skipped';

        const request: NoteCollectRequest = {
          ...context,
          target: { noteId: message.noteCard.noteId, noteTitle: message.noteCard.title, source },
          silent: options?.silent === true,
          saving: false,
        };
        const completion = request.silent
          ? new Promise<CollectMessageResult>((resolve) => { request.resolve = resolve; })
          : undefined;
        noteRequestRef.current = request;
        // Close the chat composer keyboard before mounting the separate Modal.
        // Otherwise iOS can size the new window from the keyboard-adjusted
        // presenting view, leaving the sheet anchored above a dimmed gap.
        // Disable the page KAV first, then wait for the host window to settle.
        setNoteCollectOpening(true);
        Keyboard.dismiss();
        const keyboard = waitForKeyboardToHide();
        request.cancelKeyboard = keyboard.cancel;
        await keyboard.promise;
        request.cancelKeyboard = undefined;
        if (noteRequestRef.current !== request || !isCurrentContext(request)) return 'cancelled';
        setNoteCollectTarget(request.target);
        setNoteCollectOpening(false);
        void loadNoteGroups();
        return completion ?? 'pending';
      }

      // 语音要把源 DTO 的 object key 一起收下来:UI 层的 voiceUrl 是服务端
      // 现签的临时地址,过期即失效,推不回 key —— 不存 key 的话这条收藏
      // 以后永远重发不出去(旧收藏正是卡在这里)。
      //
      // 但只收**自己发的**:key 是发送方的对象路径(chat/{senderId}/…),
      // 后端发送校验按 chat/{当前用户}/ 收口。把对端的 key 也存下来的话,
      // 收藏页会把它显示成「可重发」,而每一次重发都必然被后端拒掉 ——
      // 一个点了就报错的按钮比一个不出现的按钮更糟。收到的语音要做成可重发,
      // 得先把音频复制/重传到自己名下,那是另一件事。
      const sourceMessage =
        message.type === 'voice'
          ? useChatStore
              .getState()
              .messagesByConversation[conversationID]?.find(
                (item) => item.id === message.id,
              )
          : undefined;
      const sourceKey = sourceMessage?.content?.['key'];
      const voiceKey =
        sourceMessage?.sender?.id === currentUserID &&
        typeof sourceKey === 'string'
          ? sourceKey
          : undefined;

      const input = buildCollectionInputFromMessage(message, {
        conversationID,
        conversationTitle,
        sourceID,
        conversationType: isGroupChat ? 'group' : 'private',
        voiceKey,
      });
      if (!input) return 'skipped';

      try {
        await createCollection(input);
        if (!isCurrentContext(context)) return 'cancelled';
        if (!options?.silent) {
          Alert.alert(t('chat.messageActions.collected'), t('chat.messageActions.collectedHint'));
        }
        return 'collected';
      } catch (error) {
        reportHandledFailure('chatDetail', 'collectMessage', error);
        if (!isCurrentContext(context)) return 'cancelled';
        if (!options?.silent) {
          Alert.alert(
            t('chat.messageActions.collectFailed'),
            getApiErrorMessage(error, t('chat.messageActions.collectFailedHint')),
          );
        }
        return 'failed';
      }
    },
    [
      avatarUrl,
      conversationID,
      conversationTitle,
      currentUserID,
      isGroupChat,
      selfAvatarUri,
      selfName,
      sourceID,
      t,
      sessionEpoch,
      loadNoteGroups,
      isCurrentContext,
    ],
  );

  const handleConfirmNoteCollect = useCallback(
    async ({ targetNoteGroupId, title }: AddNoteToNotesSelection) => {
      const request = noteRequestRef.current;
      if (!request || request.target !== noteCollectTarget || request.saving || !isCurrentContext(request)) return;
      request.saving = true;
      setNoteCollectSaving(true);
      try {
        const target = request.target;
        const result = await collectNote(target.noteId, target.source, {
          targetNoteGroupId,
          title,
        });
        if (noteRequestRef.current !== request || !isCurrentContext(request)) return;
        // The notes screen may already be mounted in another tab stack. Mark
        // it stale after the server confirms the write so returning to the
        // list fetches the saved (possibly edited) title immediately.
        useNoteListSignalStore.getState().bump();
        finishNoteCollect('collected');
        if (request.silent) return;
        const copiedNoteId = result.note?.id;
        Alert.alert(
          result.alreadyCollected
            ? t('chat.messageActions.noteAlreadyCollected', {
                defaultValue: '已在我的笔记中',
              })
            : t('chat.messageActions.noteCollected', {
                defaultValue: '已添加到我的笔记',
              }),
          t('chat.messageActions.noteCollectedHint', {
            defaultValue: '可在「我的笔记」中查看',
          }),
          copiedNoteId
            ? [
                {
                  text: t('common.view', { defaultValue: '查看' }),
                  onPress: () => {
                    if (!isCurrentContext(request)) return;
                    router.push({
                      pathname: '/(tabs)/profile/notes',
                      params: { highlightNoteId: copiedNoteId },
                    } as never);
                  },
                },
                { text: t('common.confirm', { defaultValue: '确认' }) },
              ]
            : undefined,
        );
      } catch (error) {
        reportHandledFailure('chatDetail', 'collectNote', error);
        if (noteRequestRef.current !== request || !isCurrentContext(request)) return;
        if (request.silent) {
          finishNoteCollect('failed');
        } else {
          Alert.alert(
            t('chat.messageActions.collectFailed'),
            getApiErrorMessage(error, t('chat.messageActions.collectFailedHint')),
          );
        }
      } finally {
        if (noteRequestRef.current === request && isCurrentContext(request)) {
          request.saving = false;
          setNoteCollectSaving(false);
        }
      }
    },
    [noteCollectTarget, t, isCurrentContext, finishNoteCollect],
  );

  const noteCollectSheet: ReactNode = createElement(AddNoteToNotesSheet, {
    visible: noteCollectTarget !== null,
    noteTitle: noteCollectTarget?.noteTitle ?? '',
    username: selfUsername ?? selfName,
    groups: noteGroups,
    loading: noteGroupsLoading,
    saving: noteCollectSaving,
    error: noteGroupsError,
    onClose: () => finishNoteCollect('cancelled'),
    onRetryGroups: loadNoteGroups,
    onConfirm: handleConfirmNoteCollect,
  });

  return {
    handleCollectMessage,
    noteCollectSheet,
    noteCollectVisible: noteCollectTarget !== null || noteCollectOpening,
  };
}
