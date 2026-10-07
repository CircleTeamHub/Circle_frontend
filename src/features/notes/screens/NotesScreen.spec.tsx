import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import NotesScreen from './NotesScreen';
import { fetchNoteDraft } from '@/services/api/notes';

const mockRouter = { push: jest.fn(), back: jest.fn(), setParams: jest.fn() };
const mockTranslate = (key: string) => key;
const mockOrder: string[] = [];
jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return { useRouter: () => mockRouter, useLocalSearchParams: () => ({}), useSegments: () => ['(tabs)', 'profile'],
    useFocusEffect: (effect: () => void | (() => void)) => ReactModule.useEffect(effect, [effect]) };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'owner' } }) }));
jest.mock('@/features/notes/store/use-notes-tab-order-store', () => ({ useNotesTabOrderStore: (selector: (state: { orderIds: string[] }) => unknown) => selector({ orderIds: mockOrder }) }));
jest.mock('@/storage', () => ({ storage: { getString: () => undefined } }));
jest.mock('@/features/notes/utils/note-recording-storage', () => ({}));
jest.mock('@/services/api/notes', () => ({ fetchNotes: jest.fn(() => Promise.reject(new Error('offline'))), fetchNoteGroups: jest.fn(() => Promise.reject(new Error('offline'))), fetchNoteDraft: jest.fn() }));
jest.mock('@/features/notes/components/NoteCard', () => ({ NoteCard: () => null }));
jest.mock('@/features/notes/components/NoteActionsSheet', () => ({ NoteActionsSheet: () => null }));
jest.mock('@/features/notes/components/NoteRemarkSheet', () => ({ NoteRemarkSheet: () => null }));
jest.mock('@/features/notes/components/NoteGroupPickerSheet', () => ({ NoteGroupPickerSheet: () => null }));
jest.mock('@/features/notes/components/ShareNoteSheet', () => ({ ShareNoteSheet: () => null }));
jest.mock('@/features/notes/components/GroupManagerSheet', () => ({ GroupManagerSheet: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('@/theme', () => ({
  Radius: { full: 50, pill: 50 }, Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, Typography: { h1: {}, body: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111', textSecondary: '#666', primary: '#6200ee', divider: '#ddd', white: '#fff' } }),
}));

test('offline New generates distinct route IDs and explicitly requests a fresh editor', async () => {
  mockRouter.push.mockClear(); render(<NotesScreen />);
  await screen.findByText('notes.loadFailed');
  fireEvent.press(screen.getByText('notes.actions.new')); fireEvent.press(screen.getByText('notes.actions.new'));
  const routes = mockRouter.push.mock.calls.map(([route]) => route as { pathname: string; params: { draftId: string; draftMode: string } });
  expect(routes).toHaveLength(2);
  expect(routes[0].pathname).toBe('/(tabs)/profile/notes/edit'); expect(routes[0].params.draftMode).toBe('new');
  expect(routes[0].params.draftId).toBeTruthy(); expect(routes[1].params.draftId).not.toBe(routes[0].params.draftId);
  expect(fetchNoteDraft).not.toHaveBeenCalled();
});
