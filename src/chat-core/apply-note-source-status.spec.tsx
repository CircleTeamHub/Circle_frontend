import { persistLocalMessages } from '@/chat-core/local-db';
import { useChatStore } from '@/chat-core/store';
import type { ChatMessageDto } from '@/chat-core/protocol';

jest.mock('@/chat-core/local-db', () => ({
  persistLocalMessages: jest.fn(() => Promise.resolve(true)),
}));

const card = (id: string, workStatus: string): ChatMessageDto =>
  ({
    id,
    conversationId: 'c1',
    type: 'note-card',
    height: 1,
    content: { noteId: 'copy', sourceNoteId: 'boss', workStatus, publicationStatus: 'ACTIVE' },
  }) as unknown as ChatMessageDto;

const text = { id: 't1', conversationId: 'c1', type: 'text', height: 2, content: { text: 'hi' } } as unknown as ChatMessageDto;

test('a live status change patches every card of that note and writes them to the local cache', () => {
  useChatStore.setState({ messagesByConversation: { c1: [card('m1', 'WORKING'), text, card('m2', 'CLOSED')] }, conversations: [] });
  useChatStore.getState().applyNoteSourceStatus('boss', 'OFF_SHELF', 'ACTIVE');
  const timeline = useChatStore.getState().messagesByConversation.c1;
  expect(timeline.map((message) => message.content.workStatus)).toEqual(['OFF_SHELF', undefined, 'OFF_SHELF']);
  // 冷启动先读本地库:补丁不落库的话,断网打开会话又是发送那一刻的旧状态。
  expect(persistLocalMessages).toHaveBeenCalledTimes(1);
  expect(jest.mocked(persistLocalMessages).mock.calls[0][0]).toBe('c1');
  expect(jest.mocked(persistLocalMessages).mock.calls[0][1].map((message) => message.id)).toEqual(['m1', 'm2']);
});

test('nothing is written when no card changes', () => {
  jest.mocked(persistLocalMessages).mockClear();
  useChatStore.setState({ messagesByConversation: { c1: [card('m1', 'OFF_SHELF')] }, conversations: [] });
  useChatStore.getState().applyNoteSourceStatus('boss', 'OFF_SHELF', 'ACTIVE');
  expect(persistLocalMessages).not.toHaveBeenCalled();
});
