import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, FlatList } from 'react-native';
import RecycleBinScreen from './RecycleBinScreen';
import { ApiError } from '@/services/api/api-error';
import { fetchDeletedNotes, purgeNote, restoreNote } from '@/services/api/notes';
import { detachLocalNoteDraftsFromNote } from '@/features/notes/utils/note-editor-drafts';

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
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'owner' } }),
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
jest.mock('@/features/notes/utils/note-editor-drafts', () => ({ detachLocalNoteDraftsFromNote: jest.fn() }));
jest.mock('@/services/api/notes', () => ({ fetchDeletedNotes: jest.fn(), purgeNote: jest.fn(), restoreNote: jest.fn() }));

const note = { id: 'n1', title: '回收站里的笔记', groups: [], status: 'DELETED' };

function deferred<T>() {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function confirmPurge(alert: jest.SpyInstance) {
  fireEvent.press(screen.getByLabelText('notes.actions.purge'));
  return act(async () => {
    await alert.mock.calls.at(-1)?.[2]?.find((button: { text: string }) => button.text === 'notes.actions.purge')?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchDeletedNotes).mockReset().mockResolvedValueOnce([note] as never).mockResolvedValue([] as never);
});

test('a 404 from delete-now means it is already gone: the row leaves and no failure is shown', async () => {
  jest.mocked(purgeNote).mockRejectedValueOnce(new ApiError('gone', { status: 404 } as never));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<RecycleBinScreen />);
  try {
    fireEvent.press(await screen.findByLabelText('more:n1'));
    await confirmPurge(alert);
    await waitFor(() => expect(screen.queryByText('回收站里的笔记')).toBeNull());
    expect(alert).not.toHaveBeenCalledWith('notes.alerts.deleteFailedTitle', expect.anything());
  } finally { alert.mockRestore(); }
});

test('delete-now detaches local drafts that still edit the purged note', async () => {
  jest.mocked(purgeNote).mockResolvedValueOnce(undefined);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<RecycleBinScreen />);
  try {
    fireEvent.press(await screen.findByLabelText('more:n1'));
    await confirmPurge(alert);
    expect(detachLocalNoteDraftsFromNote).toHaveBeenCalledWith('owner', 'n1');
  } finally { alert.mockRestore(); }
});

test('a real delete-now failure keeps the row and tells the user', async () => {
  jest.mocked(purgeNote).mockRejectedValueOnce(new ApiError('down', { status: 500 } as never));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<RecycleBinScreen />);
  try {
    fireEvent.press(await screen.findByLabelText('more:n1'));
    await confirmPurge(alert);
    expect(alert).toHaveBeenCalledWith('notes.alerts.deleteFailedTitle', 'common.retryLater');
    expect(screen.getByText('回收站里的笔记')).toBeTruthy();
    expect(detachLocalNoteDraftsFromNote).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

test('a row whose restore is still in flight cannot be acted on again', async () => {
  let finishRestore!: () => void;
  jest.mocked(restoreNote).mockReturnValueOnce(new Promise<void>((resolve) => { finishRestore = resolve; }));
  render(<RecycleBinScreen />);
  fireEvent.press(await screen.findByLabelText('more:n1'));
  await act(async () => { fireEvent.press(screen.getByLabelText('notes.actions.restore')); });
  // 请求还没返回：再点这一行不会再开菜单。
  fireEvent.press(screen.getByLabelText('more:n1'));
  expect(screen.queryByLabelText('notes.actions.purge')).toBeNull();
  await act(async () => { finishRestore(); });
  await waitFor(() => expect(screen.queryByText('回收站里的笔记')).toBeNull());
  expect(restoreNote).toHaveBeenCalledTimes(1);
});

test('a slower focus load cannot overwrite a newer pull-to-refresh result', async () => {
  const focusLoad = deferred<never[]>();
  const refreshLoad = deferred<never[]>();
  jest
    .mocked(fetchDeletedNotes)
    .mockReset()
    .mockReturnValueOnce(focusLoad.promise)
    .mockReturnValueOnce(refreshLoad.promise);

  render(<RecycleBinScreen />);
  await waitFor(() => expect(fetchDeletedNotes).toHaveBeenCalledTimes(1));

  fireEvent(screen.UNSAFE_getByType(FlatList), 'refresh');
  await waitFor(() => expect(fetchDeletedNotes).toHaveBeenCalledTimes(2));

  await act(async () => {
    refreshLoad.resolve([
      { ...note, id: 'new', title: '较新的回收站结果' },
    ] as never);
  });
  expect(screen.getByText('较新的回收站结果')).toBeTruthy();

  await act(async () => {
    focusLoad.resolve([
      { ...note, id: 'old', title: '过期的首次加载结果' },
    ] as never);
  });

  expect(screen.queryByText('过期的首次加载结果')).toBeNull();
  expect(screen.getByText('较新的回收站结果')).toBeTruthy();
});


test('a failed newer refresh does not discard the successful initial load', async () => {
  const focus = deferred<never[]>();
  const refresh = deferred<never[]>();
  jest.mocked(fetchDeletedNotes).mockReset().mockReturnValueOnce(focus.promise).mockReturnValueOnce(refresh.promise);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    render(<RecycleBinScreen />);
    await waitFor(() => expect(fetchDeletedNotes).toHaveBeenCalledTimes(1));
    fireEvent(screen.UNSAFE_getByType(FlatList), 'refresh');
    await act(async () => refresh.reject(new Error('network')));
    await act(async () => focus.resolve([note] as never));
    expect(screen.getByText('回收站里的笔记')).toBeTruthy();
    expect(screen.UNSAFE_getByType(FlatList).props.refreshing).toBe(false);
  } finally { alert.mockRestore(); }
});
