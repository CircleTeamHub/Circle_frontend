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
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
}));
jest.mock('@/features/chat/utils/send-notes-to-conversation', () => ({
  sendNotesToConversation: jest.fn(() => Promise.resolve({ failures: 0, firstError: null })),
}));
jest.mock('@/features/chat/components/chat-target-picker/resolve-chat-target', () => ({
  resolveChatTargetConversationId: jest.fn((target: { conversationId: string | null; userId: string | null }) =>
    Promise.resolve(target.conversationId ?? `direct-${target.userId}`)),
}));
jest.mock('@/features/chat/components/chat-target-picker/use-recent-forward-targets-store', () => ({
  useRecentForwardTargetsStore: (selector: (state: { record: jest.Mock }) => unknown) =>
    selector({ record: mockRecord }),
}));
jest.mock('@/features/chat/components/chat-target-picker/ChatTargetPicker', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    ChatTargetPicker: ({ onConfirm, onClose }: { onConfirm: (targets: ChatTarget[]) => void; onClose: () => void }) => (
      <>
        <Pressable onPress={() => onConfirm(mockPickTargets)}><Text>picker.pick</Text></Pressable>
        <Pressable onPress={onClose}><Text>picker.close</Text></Pressable>
      </>
    ),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockPickTargets = [chat('conv-1')];
});

test('nothing renders while there is no share request', () => {
  render(<ShareNoteSheet request={null} onClose={jest.fn()} />);
  expect(screen.queryByText('picker.pick')).toBeNull();
});

test('the chosen sections go to the chosen chat and the sheet closes', async () => {
  const onClose = jest.fn();
  const options = { card: true, media: true, showcase: false, location: true };
  render(<ShareNoteSheet request={{ notes: [note], options }} onClose={onClose} />);
  expect(screen.queryByText('dialog.send')).toBeNull();
  await pickAndSend();
  expect(sendNotesToConversation).toHaveBeenCalledWith(
    expect.objectContaining({ conversationId: 'conv-1', notes: [note], options, ownerId: 'me' }),
  );
  expect(sendTextMessage).not.toHaveBeenCalled();
  expect(mockRecord).toHaveBeenCalledWith('me', [expect.objectContaining({ conversationId: 'conv-1' })]);
  expect(onClose).toHaveBeenCalled();
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

test('failures are reported once and keep the sheet open', async () => {
  jest.mocked(sendNotesToConversation).mockResolvedValueOnce({ failures: 2, firstError: new Error('blocked') });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const onClose = jest.fn();
  try {
    render(<ShareNoteSheet request={request} onClose={onClose} />);
    await pickAndSend();
    expect(alert).toHaveBeenCalledWith('notes.shareToChat.failedTitle', 'notes.shareToChat.partialFailed');
    expect(onClose).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

test('closing the sheet mid-send stops the rest and shows nothing afterwards', async () => {
  let finish!: (value: { failures: number; firstError: unknown }) => void;
  jest.mocked(sendNotesToConversation).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  mockPickTargets = [chat('conv-1'), chat('conv-2')];
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const onClose = jest.fn();
  try {
    const view = render(<ShareNoteSheet request={request} onClose={onClose} />);
    await pickAndSend();
    const { isActive } = jest.mocked(sendNotesToConversation).mock.calls[0][0];
    expect(isActive()).toBe(true);
    view.rerender(<ShareNoteSheet request={null} onClose={onClose} />);
    expect(isActive()).toBe(false);
    await act(async () => { finish({ failures: 1, firstError: null }); await Promise.resolve(); });
    expect(sendNotesToConversation).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});
