import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ShareNoteSheet } from './ShareNoteSheet';
import { sendCardMessage } from '@/chat-core/client';
import { withFreshNoteSourceStatus } from '@/features/chat/utils/note-card-fresh-status';
import type { NoteCardData } from '@/types';

const mockTranslate = (key: string) => key;
const mockConversations = [{ id: 'conv-1', name: '小王' }];
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/theme', () => ({
  Radius: { md: 12, lg: 16, pill: 26 }, Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, Typography: { body: {}, small: {}, caption: {} },
  useTheme: () => ({ colors: { background: '#000', surface: '#111', surfaceBorder: '#333', text: '#fff', textSecondary: '#aaa', overlay: '#0008', primary: '#6366f1', divider: '#222', white: '#fff' } }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/components/ui/bottom-sheet-modal', () => {
  const { FlatList, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? <View>{children}</View> : null),
    BottomSheetFlatList: FlatList,
  };
});
jest.mock('@/chat-core/api', () => ({ loadChatConversations: jest.fn(() => Promise.resolve()) }));
jest.mock('@/chat-core/client', () => ({ sendCardMessage: jest.fn(() => Promise.resolve()) }));
jest.mock('@/chat-core/mappers', () => ({
  mapChatConversationToUI: (item: { id: string; name: string }) => ({ id: item.id, name: item.name, conversationType: 'single' }),
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (selector: (state: { conversations: unknown[] }) => unknown) => selector({ conversations: mockConversations }),
}));
jest.mock('@/features/chat/utils/note-batch-send', () => ({
  noteSendWindowDelayMs: () => 0,
  recordNoteSendAttempt: (timestamps: number[]) => timestamps,
}));
jest.mock('@/features/chat/utils/note-work-status', () => ({
  shouldWarnNoteWorkStatus: (card: { workStatus?: string }) => card.workStatus === 'CLOSED',
}));
jest.mock('@/features/chat/utils/note-card-fresh-status', () => ({ withFreshNoteSourceStatus: jest.fn() }));

const payload = { noteId: 'note-1', title: '笔记', workStatus: 'UNSET' } as unknown as NoteCardData;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function selectAndSend() {
  fireEvent.press(screen.getByLabelText('小王'));
  fireEvent.press(screen.getByText('notes.shareToChat.sendSelected'));
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('closing the sheet while the source status is still being checked cancels the send', async () => {
  const status = deferred<NoteCardData[]>();
  jest.mocked(withFreshNoteSourceStatus).mockReturnValueOnce(status.promise as never);
  const onClose = jest.fn();
  const view = render(<ShareNoteSheet payloads={[payload]} onClose={onClose} />);
  selectAndSend();
  // 用户在状态重取返回前关掉面板（父层把 payloads 置空）。
  view.rerender(<ShareNoteSheet payloads={null} onClose={onClose} />);
  await act(async () => { status.resolve([payload]); await status.promise; });
  expect(sendCardMessage).not.toHaveBeenCalled();
});

test('a work-status warning confirmed after the sheet was closed does not send', async () => {
  const closed = { ...payload, workStatus: 'CLOSED' } as unknown as NoteCardData;
  jest.mocked(withFreshNoteSourceStatus).mockResolvedValueOnce([closed] as never);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const onClose = jest.fn();
  try {
    const view = render(<ShareNoteSheet payloads={[closed]} onClose={onClose} />);
    selectAndSend();
    await act(async () => { await Promise.resolve(); });
    expect(alert).toHaveBeenCalledWith('notes.shareToChat.confirmTitle', 'notes.shareToChat.workStatusWarning', expect.anything(), expect.anything());
    view.rerender(<ShareNoteSheet payloads={null} onClose={onClose} />);
    await act(async () => {
      alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'common.send')?.onPress?.();
    });
    expect(sendCardMessage).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

test('an open sheet still sends right after the status check', async () => {
  jest.mocked(withFreshNoteSourceStatus).mockResolvedValueOnce([payload] as never);
  const onClose = jest.fn();
  render(<ShareNoteSheet payloads={[payload]} onClose={onClose} />);
  selectAndSend();
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(sendCardMessage).toHaveBeenCalledWith({ conversationId: 'conv-1', type: 'note-card', payload });
  expect(onClose).toHaveBeenCalled();
});
