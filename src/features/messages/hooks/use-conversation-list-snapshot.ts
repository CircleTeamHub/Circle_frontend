import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/chat-core/store';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { getPageSnapshotRevision, readPageSnapshot, writePageSnapshot } from '@/storage/page-snapshots';
import type { Conversation } from '@/types';

const KEY = 'chat:conversation-list';

/** Synchronous list shell while encrypted SQLite opens; never a live chat snapshot. */
export function useConversationListSnapshot(live: Conversation[], snapshotLoaded: boolean) {
  const ownerId = useAuthStore((state) => state.user?.id);
  const epoch = useAuthStore((state) => state.sessionEpoch);
  const chatOwnerId = useChatStore((state) => state.currentUserId);
  const scope = `${ownerId ?? ''}:${epoch}`;
  const revision = getPageSnapshotRevision();
  // Re-login and explicit cache clear must invalidate even the same owner's read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snapshot = useMemo(() => readPageSnapshot<Conversation[]>(ownerId, KEY), [ownerId, epoch, revision]);
  const liveSeen = useRef({ scope, value: false });
  if (liveSeen.current.scope !== scope) liveSeen.current = { scope, value: false };
  const currentLive = chatOwnerId === ownerId ? live : [];
  if (chatOwnerId === ownerId && (snapshotLoaded || currentLive.length > 0)) liveSeen.current.value = true;

  useEffect(() => {
    if (!ownerId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let queuedRevision = getPageSnapshotRevision();
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const auth = useAuthStore.getState();
      const state = useChatStore.getState();
      if (auth.user?.id !== ownerId || auth.sessionEpoch !== epoch ||
        state.currentUserId !== ownerId || !state.conversationsSnapshotLoaded ||
        queuedRevision !== getPageSnapshotRevision()) return;
      const rows = state.conversations.map(mapChatConversationToUI).filter((row) => !row.isAssistant)
        .map((row) => ({ ...row, message: '', draftPreview: undefined }));
      // Message bodies/expiry policies remain exclusively in the existing chat DB.
      writePageSnapshot(ownerId, KEY, rows);
    };
    const queue = () => {
      queuedRevision = getPageSnapshotRevision();
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 250);
    };
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (state.conversations !== previous.conversations ||
        state.conversationsSnapshotLoaded !== previous.conversationsSnapshotLoaded) queue();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && timer) flush();
    });
    queue();
    return () => {
      unsubscribe();
      appState.remove();
      if (timer) flush();
    };
  }, [epoch, ownerId]);

  return {
    conversations: !liveSeen.current.value && snapshot ? snapshot.value : currentLive,
    snapshotKnown: snapshot !== null,
  };
}
