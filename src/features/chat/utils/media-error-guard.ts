import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/chat-core/store';

export function mediaErrorGuard(conversationId: string, mounted: { current: boolean }) {
  const epoch = useAuthStore.getState().sessionEpoch;
  return () => mounted.current &&
    useAuthStore.getState().sessionEpoch === epoch &&
    useChatStore.getState().activeConversationId === conversationId;
}
