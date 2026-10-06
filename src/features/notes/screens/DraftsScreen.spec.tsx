import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import DraftsScreen from './DraftsScreen';
import { fetchNoteDrafts, deleteNoteDraft } from '@/services/api/notes';
import { removeLocalNoteDraft } from '@/features/notes/utils/note-editor-drafts';

const mockAuth = { user: { id: 'a' }, sessionEpoch: 0 };
const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockTranslate = (key: string) => key;
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (state: typeof mockAuth) => unknown) => selector(mockAuth), { getState: () => mockAuth }),
}));
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
  Spacing: { sm: 8, md: 12, lg: 16, xl: 24 }, Typography: { h2: {}, body: {}, bodyRegular: {}, caption: {} },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111', textSecondary: '#666', primary: '#6200ee' } }),
}));
jest.mock('@/features/notes/utils/note-format', () => ({ formatNoteDate: () => 'date' }));
jest.mock('@/services/api/notes', () => ({ fetchNoteDrafts: jest.fn(), deleteNoteDraft: jest.fn() }));
jest.mock('@/features/notes/utils/note-editor-drafts', () => ({
  loadLocalNoteDraftSummaries: () => [], removeLocalNoteDraft: jest.fn(),
}));

function draft(id: string) {
  return { id, title: id, contentPreview: '', mediaCount: 0, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' };
}
beforeEach(() => { jest.clearAllMocks(); mockAuth.user = { id: 'a' }; mockAuth.sessionEpoch = 0; });

test('a prior account response cannot populate the next account draft list', async () => {
  let resolve!: (value: ReturnType<typeof draft>[]) => void;
  jest.mocked(fetchNoteDrafts).mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValueOnce([draft('b-draft')]);
  const view = render(<DraftsScreen />);
  await waitFor(() => expect(fetchNoteDrafts).toHaveBeenCalledTimes(1));
  mockAuth.user = { id: 'b' }; mockAuth.sessionEpoch += 1;
  view.rerender(<DraftsScreen />);
  await waitFor(() => expect(screen.getByText('b-draft')).toBeTruthy());
  await act(async () => { resolve([draft('a-private-draft')]); });
  expect(screen.queryByText('a-private-draft')).toBeNull();
  expect(screen.getByText('b-draft')).toBeTruthy();
});

test('failed server deletion preserves the draft and displays a retryable error', async () => {
  jest.mocked(fetchNoteDrafts).mockResolvedValue([draft('keep-me')]);
  jest.mocked(deleteNoteDraft).mockRejectedValue(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    render(<DraftsScreen />);
    await waitFor(() => expect(screen.getByText('keep-me')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('notes.drafts.deleteLabel'));
    const confirm = alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'common.delete');
    await act(async () => { confirm?.onPress?.(); });
    await waitFor(() => expect(deleteNoteDraft).toHaveBeenCalledWith('keep-me'));
    expect(screen.getByText('keep-me')).toBeTruthy();
    expect(removeLocalNoteDraft).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('common.errorOccurred', 'notes.drafts.deleteFailed');
  } finally { alert.mockRestore(); }
});
