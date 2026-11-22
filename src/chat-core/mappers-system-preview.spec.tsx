import { getChatMessagePreview } from './mappers';
import { systemNoticeText } from './message-mappers';
import type { ChatMessageDto } from './protocol';

function systemMessage(content: Record<string, unknown>): ChatMessageDto {
  return {
    id: 'm1',
    conversationId: 'c1',
    height: 1,
    type: 'system',
    content,
    sender: null,
    revokedAt: null,
  } as unknown as ChatMessageDto;
}

describe('conversation list preview of system notices', () => {
  // 建群、进群、改群名等系统通知以前在会话列表里一律显示成「[消息]」。
  it.each([
    { kind: 'group-created' },
    { kind: 'member-joined', names: ['Ada', 'Bob'] },
    { kind: 'group-renamed', name: '周末爬山' },
  ])('shows the same text the chat shows for %o', (content) => {
    const preview = getChatMessagePreview(systemMessage(content));
    expect(preview).toBe(systemNoticeText(content));
    expect(preview).not.toBe('');
    expect(preview).not.toContain('[');
  });

  it('falls back to the generic label for a notice kind it does not know', () => {
    expect(getChatMessagePreview(systemMessage({ kind: 'from-the-future' }))).not.toBe('');
  });
});
