import { renderHook } from '@testing-library/react-native';
import type { TFunction } from 'i18next';
import type { ChatConversationDto } from '@/chat-core/protocol';
import { useChatConversation } from './use-chat-conversation';

let mockState: Record<string, unknown>;
jest.mock('@/chat-core/store', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector(mockState),
}));
jest.mock('@/chat-core/client', () => ({
  ensureCircleConversation: jest.fn(),
  ensureDirectConversation: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@/features/chat/hooks/use-group-member-view-access', () => ({
  useGroupMemberViewAccess: () => ({ canViewMembers: false, revalidate: jest.fn() }),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

const ME = 'user-me';
const PEER = 'user-peer';
// 会话 id 必须是 UUID 形状,否则 resolveChatDetailIdentity 当成非法 id 清空。
const CONVERSATION_ID = '7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const t = ((_key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? '') as unknown as TFunction<'translation', undefined>;

function seedStore(localReadHeight: number) {
  const conversation = {
    id: CONVERSATION_ID,
    type: 'DIRECT',
    unreadCount: 0,
    readHeight: 100,
  } as unknown as ChatConversationDto;
  mockState = {
    conversations: [conversation],
    readWatermarks: { [CONVERSATION_ID]: { [ME]: localReadHeight } },
    deliveredWatermarks: {},
    messagesByConversation: {},
    currentUserId: ME,
    viewerSelfDestructSec: 0,
    viewerSelfDestructStartedAt: null,
  };
}

function renderEntry(params: { initialUnreadCount?: string; initialReadHeight?: string }) {
  return renderHook(() =>
    useChatConversation({
      t,
      currentUserID: ME,
      params: {
        conversationID: CONVERSATION_ID,
        sourceID: PEER,
        conversationType: 'private',
        ...params,
      },
    }),
  );
}

// 消息列表点击 = 先把入口参数取好(点击前水位 100),再标已读(本机水位推到 125),
// 再跳转。详情页首帧看到的 store 已经是 125。
test('entry read height keeps the pre-tap watermark the message list passed in', () => {
  seedStore(125);
  const { result } = renderEntry({ initialUnreadCount: '25', initialReadHeight: '100' });
  expect(result.current.entryReadHeight).toBe(100);
  expect(result.current.entryUnreadCount).toBe(25);
});

// 通知等不带路由参数的入口:首帧时还没标已读,本机水位就是进入前的真实水位。
test('without a route watermark it falls back to the local read watermark', () => {
  seedStore(110);
  const { result } = renderEntry({});
  expect(result.current.entryReadHeight).toBe(110);
});
