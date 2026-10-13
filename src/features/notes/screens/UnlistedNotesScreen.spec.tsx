import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import UnlistedNotesScreen from './UnlistedNotesScreen';
import { deleteNote, fetchNotes, relistNote } from '@/services/api/notes';

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockTranslate = (key: string) => key;
jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return { useRouter: () => mockRouter, useFocusEffect: (effect: () => void | (() => void)) => ReactModule.useEffect(effect, [effect]) };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/theme', () => ({
  Radius: { pill: 26 }, Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, Typography: { h1: {}, small: {}, bodyRegular: {}, caption: {}, body: {} },
  useTheme: () => ({ colors: { background: '#000', surface: '#111', surfaceBorder: '#333', text: '#fff', overlay: '#0008', iconAccent: '#b18aff', danger: '#f66' } }),
}));
jest.mock('@/features/notes/store/use-note-status-signal-store', () => ({
  useNoteStatusSignalStore: (selector: (state: { version: number; lastChange: null }) => unknown) => selector({ version: 0, lastChange: null }),
}));
jest.mock('@/features/notes/utils/note-sync', () => ({
  applyNoteSourceStatusToSummaries: (notes: unknown) => notes,
  withNoteSyncRetry: (run: () => Promise<unknown>) => run(),
}));
jest.mock('@/components/ui/keyboard-dismiss', () => ({ keyboardDismissOnDragProps: {} }));
jest.mock('@/components/ui/bottom-sheet-modal', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? <View>{children}</View> : null) };
});
jest.mock('@/features/notes/components/NoteCard', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NoteCard: ({ note, onMorePress }: { note: { id: string; title: string }; onMorePress: (note: unknown) => void }) => (
      <Pressable accessibilityRole="button" accessibilityLabel={`more:${note.id}`} onPress={() => onMorePress(note)}>
        <Text>{note.title}</Text>
      </Pressable>
    ),
  };
});
jest.mock('@/services/api/notes', () => ({ fetchNotes: jest.fn(), deleteNote: jest.fn(), relistNote: jest.fn() }));

const note = { id: 'n1', title: '已下架的笔记', groups: [], status: 'UNLISTED' };

function pressAlertButton(alert: jest.SpyInstance, text: string) {
  return act(async () => {
    await alert.mock.calls.at(-1)?.[2]?.find((button: { text: string }) => button.text === text)?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchNotes).mockReset().mockResolvedValueOnce([note] as never);
});

test('a successful delete whose list refresh fails removes the row and does not report a delete failure', async () => {
  jest.mocked(deleteNote).mockResolvedValueOnce(undefined);
  jest.mocked(fetchNotes).mockRejectedValueOnce(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<UnlistedNotesScreen />);
  try {
    fireEvent.press(await screen.findByLabelText('more:n1'));
    fireEvent.press(screen.getByLabelText('notes.actions.delete'));
    await pressAlertButton(alert, 'notes.actions.delete');
    expect(deleteNote).toHaveBeenCalledWith('n1');
    await waitFor(() => expect(screen.queryByText('已下架的笔记')).toBeNull());
    expect(alert).not.toHaveBeenCalledWith('notes.alerts.deleteFailedTitle', expect.anything());
  } finally { alert.mockRestore(); }
});

test('a failed delete keeps the row and tells the user', async () => {
  jest.mocked(deleteNote).mockRejectedValueOnce(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<UnlistedNotesScreen />);
  try {
    fireEvent.press(await screen.findByLabelText('more:n1'));
    fireEvent.press(screen.getByLabelText('notes.actions.delete'));
    await pressAlertButton(alert, 'notes.actions.delete');
    expect(alert).toHaveBeenCalledWith('notes.alerts.deleteFailedTitle', 'common.retryLater');
    expect(screen.getByText('已下架的笔记')).toBeTruthy();
  } finally { alert.mockRestore(); }
});

test('a successful relist whose list refresh fails removes the row and does not report a relist failure', async () => {
  jest.mocked(relistNote).mockResolvedValueOnce(undefined as never);
  jest.mocked(fetchNotes).mockRejectedValueOnce(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<UnlistedNotesScreen />);
  try {
    fireEvent.press(await screen.findByLabelText('more:n1'));
    await act(async () => { fireEvent.press(screen.getByLabelText('notes.actions.relist')); });
    expect(relistNote).toHaveBeenCalledWith('n1');
    await waitFor(() => expect(screen.queryByText('已下架的笔记')).toBeNull());
    expect(alert).not.toHaveBeenCalledWith('notes.alerts.relistFailedTitle', expect.anything());
  } finally { alert.mockRestore(); }
});
