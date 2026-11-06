import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { NOTE_SHARE_CARD_ONLY, ShareNoteSheet, type NoteShareRequest } from './ShareNoteSheet';
import { sendTextMessage } from '@/chat-core/client';
import { sendNotesToConversation } from '@/features/chat/utils/send-notes-to-conversation';
import { resolveChatTargetConversationId } from '@/features/chat/components/chat-target-picker/resolve-chat-target';
import type { ChatTarget } from '@/features/chat/components/chat-target-picker/types';
import type { NoteSummary } from '@/features/notes/types';

const mockRecord = jest.fn();
const mockShowTopNotice = jest.fn();
let mockUserId = 'me';
let mockPickTargets: ChatTarget[] = [];

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  Typography: { small: {} },
  useTheme: () => ({ colors: { textSecondary: '#666' } }),
}));
jest.mock('@/chat-core/client', () => ({ sendTextMessage: jest.fn(() => Promise.resolve()) }));
jest.mock('@/chat-core/send-errors', () => ({
  getChatSendErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
    { getState: () => ({ user: { id: mockUserId } }) },
  ),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('@/components/app/top-notice-store', () => ({
  showTopNotice: (...args: unknown[]) => mockShowTopNotice(...args),
}));
jest.mock('@/features/chat/utils/send-notes-to-conversation', () => ({
  sendNotesToConversation: jest.fn(() => Promise.resolve({ failures: 0, firstError: null, sent: 1 })),
}));
jest.mock('@/features/chat/components/chat-target-picker/resolve-chat-target', () => {
  const resolveChatTargetConversationId = jest.fn(
    (target: { conversationId: string | null; userId: string | null }) =>
      Promise.resolve(target.conversationId ?? `direct-${target.userId}`),
  );
  return {
    resolveChatTargetConversationId,
    resolveChatTargets: async (targets: { conversationId: string | null; userId: string | null }[]) => {
      const resolved: { target: unknown; conversationId: string }[] = [];
      const failed: { target: unknown; error: unknown }[] = [];
      for (const target of targets) {
        try {
          resolved.push({ target, conversationId: await resolveChatTargetConversationId(target) });
        } catch (error) {
          failed.push({ target, error });
        }
      }
      return { resolved, failed };
    },
    chatTargetResolveFailureMessage: () => 'resolve.failed',
  };
});
jest.mock('@/features/chat/components/chat-target-picker/use-recent-forward-targets-store', () => ({
  useRecentForwardTargetsStore: (selector: (state: { record: jest.Mock }) => unknown) =>
    selector({ record: mockRecord }),
}));
jest.mock('@/features/chat/components/chat-target-picker/ChatTargetPicker', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    ChatTargetPicker: (props: {
      onConfirm: (targets: ChatTarget[]) => void;
      onClose: () => void;
    }) => {
      return (
        <>
          <Pressable onPress={() => props.onConfirm(mockPickTargets)}><Text>picker.pick</Text></Pressable>
          <Pressable onPress={props.onClose}><Text>picker.close</Text></Pressable>
        </>
      );
    },
  };
});
jest.mock('@/features/chat/components/send-confirm-dialog', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    SendConfirmDialog: ({ visible, children, onConfirm }: {
      visible: boolean; children: React.ReactNode; onConfirm: (caption: string) => void;
    }) => (visible ? (
      <View>
        {children}
        <Pressable onPress={() => onConfirm('')}><Text>dialog.send</Text></Pressable>
        <Pressable onPress={() => onConfirm('一起看看')}><Text>dialog.sendWithCaption</Text></Pressable>
      </View>
    ) : null),
  };
});

const note = { id: 'note-1', title: '北京大妞', ownerId: 'me' } as NoteSummary;
const chat = (id: string): ChatTarget => ({ key: id, conversationId: id, userId: null, name: id, kind: 'direct' });
const request: NoteShareRequest = { notes: [note], options: NOTE_SHARE_CARD_ONLY };

async function pickAndSend(button = 'dialog.send') {
  fireEvent.press(screen.getByText('picker.pick'));
  await act(async () => {
    fireEvent.press(screen.getByText(button));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'me';
  mockPickTargets = [chat('conv-1')];
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => alertSpy.mockRestore());

/** 「已发送」弹窗的两个按钮:确定、查看。 */
function sentButtons(): { text: string; onPress?: () => void }[] {
  const call = alertSpy.mock.calls.find(([title]) => title === 'chat.targetPicker.sent');
  if (!call) throw new Error('「已发送」弹窗没有弹出');
  return call[2] as { text: string; onPress?: () => void }[];
}

test('nothing renders while there is no share request', () => {
  render(<ShareNoteSheet request={null} onClose={jest.fn()} />);
  expect(screen.queryByText('picker.pick')).toBeNull();
});

test('sending says "sent" at once and "confirm" closes the sheet without waiting', async () => {
  jest.mocked(sendNotesToConversation).mockReturnValueOnce(new Promise(() => undefined));
  const onClose = jest.fn();
  render(<ShareNoteSheet request={request} onClose={onClose} />);
  fireEvent.press(screen.getByText('picker.pick'));
  fireEvent.press(screen.getByText('dialog.send'));
  expect(sentButtons().map((button) => button.text)).toEqual(['common.confirm', 'chat.targetPicker.view']);
  expect(onClose).not.toHaveBeenCalled();
  sentButtons()[0].onPress?.();
  expect(onClose).toHaveBeenCalled();
});

test('the chosen sections go to the chosen chat', async () => {
  const options = { card: true, media: true, showcase: false, location: true };
  render(<ShareNoteSheet request={{ notes: [note], options }} onClose={jest.fn()} />);
  expect(screen.queryByText('dialog.send')).toBeNull();
  await pickAndSend();
  expect(sendNotesToConversation).toHaveBeenCalledWith(
    expect.objectContaining({ conversationId: 'conv-1', notes: [note], options, ownerId: 'me' }),
  );
  expect(sendTextMessage).not.toHaveBeenCalled();
  expect(mockRecord).toHaveBeenCalledWith('me', [expect.objectContaining({ conversationId: 'conv-1' })]);
  expect(mockShowTopNotice).not.toHaveBeenCalled();
});

test('each selected chat gets the notes followed by the caption', async () => {
  mockPickTargets = [chat('conv-1'), { key: 'user:u2', conversationId: null, userId: 'u2', name: '小王', kind: 'direct' }];
  render(<ShareNoteSheet request={request} onClose={jest.fn()} />);
  await pickAndSend('dialog.sendWithCaption');
  expect(resolveChatTargetConversationId).toHaveBeenCalledTimes(2);
  expect(jest.mocked(sendNotesToConversation).mock.calls.map(([input]) => input.conversationId)).toEqual(['conv-1', 'direct-u2']);
  expect(sendTextMessage).toHaveBeenNthCalledWith(1, { conversationId: 'conv-1', text: '一起看看' });
  expect(sendTextMessage).toHaveBeenNthCalledWith(2, { conversationId: 'direct-u2', text: '一起看看' });
});

test('failures show up as one top notice', async () => {
  jest.mocked(sendNotesToConversation).mockResolvedValueOnce({ failures: 2, firstError: new Error('blocked'), sent: 0 });
  render(<ShareNoteSheet request={request} onClose={jest.fn()} />);
  await pickAndSend();
  expect(mockShowTopNotice).toHaveBeenCalledTimes(1);
  expect(mockShowTopNotice).toHaveBeenCalledWith(expect.objectContaining({
    type: 'error', title: 'notes.shareToChat.failedTitle', message: 'notes.shareToChat.partialFailed',
  }));
});

test('closing the sheet keeps sending to the remaining chats', async () => {
  let finish!: (value: { failures: number; firstError: unknown; sent: number }) => void;
  jest.mocked(sendNotesToConversation).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  mockPickTargets = [chat('conv-1'), chat('conv-2')];
  const onClose = jest.fn();
  const view = render(<ShareNoteSheet request={request} onClose={onClose} />);
  await pickAndSend();
  sentButtons()[0].onPress?.();
  view.rerender(<ShareNoteSheet request={null} onClose={onClose} />);
  const { isActive } = jest.mocked(sendNotesToConversation).mock.calls[0][0];
  expect(isActive()).toBe(true);
  await act(async () => { finish({ failures: 0, firstError: null, sent: 1 }); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(jest.mocked(sendNotesToConversation).mock.calls.map(([input]) => input.conversationId)).toEqual(['conv-1', 'conv-2']);
});

test('switching account stops what is left of the send', async () => {
  render(<ShareNoteSheet request={request} onClose={jest.fn()} />);
  await pickAndSend();
  const { isActive } = jest.mocked(sendNotesToConversation).mock.calls[0][0];
  mockUserId = 'someone-else';
  expect(isActive()).toBe(false);
});

test('a chat that cannot be opened is reported, and the others still get the notes', async () => {
  const stranger: ChatTarget = { key: 'user:u9', conversationId: null, userId: 'u9', name: '拉黑我的人', kind: 'direct' };
  mockPickTargets = [chat('conv-1'), stranger];
  jest.mocked(resolveChatTargetConversationId)
    .mockResolvedValueOnce('conv-1')
    .mockRejectedValueOnce(new Error('CHAT_BLOCKED'));
  render(<ShareNoteSheet request={request} onClose={jest.fn()} />);
  await pickAndSend();
  expect(mockShowTopNotice).toHaveBeenCalledWith(expect.objectContaining({
    title: 'notes.shareToChat.failedTitle', message: 'resolve.failed',
  }));
  expect(jest.mocked(sendNotesToConversation).mock.calls.map(([input]) => input.conversationId)).toEqual(['conv-1']);
});

test('the caption is not sent to a chat where none of the content arrived', async () => {
  jest.mocked(sendNotesToConversation).mockResolvedValueOnce({ failures: 1, firstError: null, sent: 0 });
  render(<ShareNoteSheet request={request} onClose={jest.fn()} />);
  await pickAndSend('dialog.sendWithCaption');
  expect(sendTextMessage).not.toHaveBeenCalled();
  expect(mockShowTopNotice).toHaveBeenCalled();
});
