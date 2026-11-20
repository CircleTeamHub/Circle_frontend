import { Alert } from 'react-native';
import { router } from 'expo-router';
import { announceSent } from './announce-sent';
import type { ChatTarget } from './types';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

const t = ((key: string) => key) as never;

async function tapView(target: ChatTarget, conversationId: string) {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  announceSent({
    t,
    targets: [target],
    resolution: Promise.resolve([{ target, conversationId }]),
    onDismiss: jest.fn(),
    scope: 'messages',
  });
  const buttons = alert.mock.calls.at(-1)?.[2] ?? [];
  buttons[1].onPress?.();
  await Promise.resolve();
  await Promise.resolve();
  return (router.push as jest.Mock).mock.calls[0][0].params;
}

describe('announceSent 「查看」', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 圈子群的 sourceID 是圈子 id(成员目录/圈子详情都按它取),不是会话 id。
  it('opens a circle group with the circle id as sourceID', async () => {
    const params = await tapView(
      { key: 'conv-circle', conversationId: 'conv-circle', userId: null, circleId: 'circle-1', name: '圈子群', kind: 'group' },
      'conv-circle',
    );
    expect(params).toMatchObject({ conversationID: 'conv-circle', sourceID: 'circle-1' });
  });

  it('keeps the conversation id for a standalone group and the peer id for a direct chat', async () => {
    const group = await tapView(
      { key: 'conv-standalone', conversationId: 'conv-standalone', userId: null, circleId: null, name: '群', kind: 'group' },
      'conv-standalone',
    );
    expect(group.sourceID).toBe('conv-standalone');
    (router.push as jest.Mock).mockClear();
    const direct = await tapView(
      { key: 'conv-d', conversationId: 'conv-d', userId: 'user-9', name: '好友', kind: 'direct' },
      'conv-d',
    );
    expect(direct.sourceID).toBe('user-9');
  });
});
