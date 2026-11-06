import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GroupBoundNotesReadOnly } from './GroupBoundNotesReadOnly';
import { fetchGroupBoundNotes } from '@/services/api/notes';
import { useNoteStatusSignalStore } from '@/features/notes/store/use-note-status-signal-store';
import type { NoteSummary } from '@/features/notes/types';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
const mockT = (key: string) => key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/services/api/notes', () => ({ fetchGroupBoundNotes: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/features/notes/components/NoteCard', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    NoteCard: ({ note, onPress }: { note: NoteSummary; onPress: (note: NoteSummary) => void }) => (
      <Pressable onPress={() => onPress(note)}>
        <Text>{`${note.title}:${note.workStatus ?? 'UNSET'}`}</Text>
      </Pressable>
    ),
  };
});
jest.mock('@/theme', () => ({
  Radius: { full: 99 },
  Spacing: { sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { small: {}, bodyRegular: {}, body: {} },
  useTheme: () => ({ colors: { primary: '#70f', text: '#111', textSecondary: '#666', surface: '#fff' } }),
}));

const note = (id: string, workStatus: NoteSummary['workStatus'] = 'WORKING') =>
  ({ id, title: `笔记${id}`, workStatus, status: 'ACTIVE', ownerId: 'owner' }) as NoteSummary;

beforeEach(() => {
  jest.clearAllMocks();
  useNoteStatusSignalStore.setState({ lastChange: null });
});

async function renderView() {
  const onOpenNote = jest.fn();
  render(<GroupBoundNotesReadOnly conversationID="conv-1" onOpenNote={onOpenNote} onSourcePress={jest.fn()} />);
  await act(async () => { await Promise.resolve(); });
  return onOpenNote;
}

test('lists the notes bound to the group with their status', async () => {
  jest.mocked(fetchGroupBoundNotes).mockResolvedValue([note('1', 'WORKING'), note('2', 'OFF_SHELF')]);
  const onOpenNote = await renderView();
  expect(fetchGroupBoundNotes).toHaveBeenCalledWith('conv-1');
  expect(screen.getByText('笔记1:WORKING')).toBeTruthy();
  expect(screen.getByText('笔记2:OFF_SHELF')).toBeTruthy();
  fireEvent.press(screen.getByText('笔记1:WORKING'));
  expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
});

test('a live status change is applied without reloading', async () => {
  jest.mocked(fetchGroupBoundNotes).mockResolvedValue([note('1', 'WORKING')]);
  await renderView();
  act(() => {
    useNoteStatusSignalStore.setState({
      lastChange: { sourceNoteId: '1', workStatus: 'CLOSED', status: 'ACTIVE', available: true, changedAt: '2026-11-06T00:00:00.000Z' },
    });
  });
  expect(screen.getByText('笔记1:CLOSED')).toBeTruthy();
  expect(fetchGroupBoundNotes).toHaveBeenCalledTimes(1);
});

test('a status change that lands while the list is loading is not overwritten by the older snapshot', async () => {
  let resolveNotes: (value: NoteSummary[]) => void = () => undefined;
  jest.mocked(fetchGroupBoundNotes).mockReturnValueOnce(new Promise((resolve) => { resolveNotes = resolve; }));
  render(<GroupBoundNotesReadOnly conversationID="conv-1" onOpenNote={jest.fn()} onSourcePress={jest.fn()} />);
  act(() => {
    useNoteStatusSignalStore.getState().bump({
      sourceNoteId: '1', workStatus: 'CLOSED', status: 'ACTIVE', available: true, changedAt: '2026-11-06T00:00:00.000Z',
    });
  });
  await act(async () => { resolveNotes([note('1', 'WORKING')]); });
  expect(screen.getByText('笔记1:CLOSED')).toBeTruthy();
});

test('an empty group says nothing is bound yet', async () => {
  jest.mocked(fetchGroupBoundNotes).mockResolvedValue([]);
  await renderView();
  expect(screen.getByText('chat.groupManagement.noSourceNotes')).toBeTruthy();
});

test('a failed load can be retried', async () => {
  jest.mocked(fetchGroupBoundNotes)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce([note('1')]);
  await renderView();
  expect(screen.getByText('chat.groupManagement.loadFailed')).toBeTruthy();
  fireEvent.press(screen.getByText('common.retry'));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('笔记1:WORKING')).toBeTruthy();
});
