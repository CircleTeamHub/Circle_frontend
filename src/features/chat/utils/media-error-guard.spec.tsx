import { mediaErrorGuard } from './media-error-guard';
const mockSession = { sessionEpoch: 1 };
const mockChat = { activeConversationId: 'chat' };
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockSession } }));
jest.mock('@/chat-core/store', () => ({ useChatStore: { getState: () => mockChat } }));
test('a retry failure cannot update an inactive chat or another account', async () => {
  mockSession.sessionEpoch = 1; mockChat.activeConversationId = 'chat';
  const mounted = { current: true };
  const canReport = mediaErrorGuard('chat', mounted);
  expect(canReport()).toBe(true);
  await Promise.resolve();
  mockChat.activeConversationId = null as any;
  expect(canReport()).toBe(false);
  mockChat.activeConversationId = 'chat'; mockSession.sessionEpoch = 2;
  expect(canReport()).toBe(false);
  mockSession.sessionEpoch = 1; mounted.current = false;
  expect(canReport()).toBe(false);
});
