import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import NoteManagementScreen from './NoteManagementScreen';

const mockFocusCallbacks = new Set<() => unknown>();
const mockFetchMembers = jest.fn();
const mockReadOnlyMounts = jest.fn();
let mockCachedNotes: { value: unknown[] } | null = null;

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useFocusEffect: (callback: () => (() => void) | void) => {
      useEffect(() => {
        mockFocusCallbacks.add(callback);
        const cleanup = callback();
        return () => {
          mockFocusCallbacks.delete(callback);
          if (typeof cleanup === 'function') cleanup();
        };
      }, [callback]);
    },
    useLocalSearchParams: () => ({ conversationID: 'room' }),
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    useSegments: () => ['(tabs)', 'messages'],
  };
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/stores/authStore', () => {
  const state = { user: { id: 'member' }, sessionEpoch: 1 };
  return {
    useAuthStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});
jest.mock('@/chat-core/store', () => ({
  useChatStore: (select: (state: unknown) => unknown) =>
    select({ currentUserId: 'member', conversations: [{ id: 'room', ownerId: 'owner' }] }),
}));
jest.mock('@/chat-core/api', () => ({
  fetchChatMembers: (...args: unknown[]) => mockFetchMembers(...args),
  refreshConversationOrList: jest.fn(async () => undefined),
}));
jest.mock('@/services/api/notes', () => ({
  fetchNotes: jest.fn(async () => []),
  getCachedNotes: () => mockCachedNotes,
  notesMutatedSince: () => false,
  setNoteSourceGroup: jest.fn(),
  setNoteWorkStatus: jest.fn(),
}));
jest.mock('@/services/api/circles', () => ({ fetchCircleDetail: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/services/api/client', () => ({ ApiError: class ApiError extends Error { status = 0; } }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/components/ui/nav-header', () => {
  const { Text } = jest.requireActual('react-native');
  return { NavHeader: ({ title }: { title: string }) => <Text testID="nav-title">{title}</Text> };
});
jest.mock('@/components/ui/bottom-sheet-modal', () => ({ BottomSheetModal: () => null }));
jest.mock('@/components/ui/floating-action-button', () => ({ FloatingActionButton: () => null }));
jest.mock('@/features/notes/components/NoteCard', () => ({ NoteCard: () => null }));
jest.mock('@/features/notes/components/GroupBoundNotesReadOnly', () => {
  const { useEffect } = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    GroupBoundNotesReadOnly: () => {
      useEffect(() => { mockReadOnlyMounts(); }, []);
      return <Text>member-read-only</Text>;
    },
  };
});
jest.mock('@/theme', () => {
  const token = new Proxy({}, { get: () => 8 });
  const typography = new Proxy({}, { get: () => ({}) });
  const colors = new Proxy({}, { get: () => '#000' });
  return {
    Radius: token,
    Spacing: token,
    Typography: typography,
    useTheme: () => ({ colors }),
    withAlpha: (color: string) => color,
  };
});

const members = [
  { userId: 'owner', role: 'OWNER' },
  { userId: 'member', role: 'MEMBER' },
];

function refocus() {
  for (const callback of [...mockFocusCallbacks]) callback();
}

beforeEach(() => {
  mockFocusCallbacks.clear();
  mockFetchMembers.mockReset().mockResolvedValue(members);
  mockReadOnlyMounts.mockReset();
  mockCachedNotes = { value: [{ id: 'cached', title: 'mine', status: 'ACTIVE' }] };
});

test('a member with cached notes never sees the owner view while the group loads', async () => {
  let resolveMembers: (value: unknown) => void = () => undefined;
  mockFetchMembers.mockReturnValueOnce(new Promise((resolve) => { resolveMembers = resolve; }));
  render(<NoteManagementScreen />);
  expect(screen.queryByText('本群还没有关联笔记')).toBeNull();
  expect(screen.getByTestId('nav-title').props.children).toBe('笔记管理');

  await act(async () => { resolveMembers(members); });
  expect(screen.getByText('member-read-only')).toBeTruthy();
  expect(screen.getByTestId('nav-title').props.children).toBe('群笔记');
});

test('returning to the page keeps the member list mounted through the reload and its failure', async () => {
  render(<NoteManagementScreen />);
  await waitFor(() => expect(screen.getByText('member-read-only')).toBeTruthy());
  expect(mockReadOnlyMounts).toHaveBeenCalledTimes(1);

  let rejectMembers: (error: unknown) => void = () => undefined;
  mockFetchMembers.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectMembers = reject; }));
  act(() => { refocus(); });
  expect(screen.getByText('member-read-only')).toBeTruthy();
  expect(screen.queryByText('本群还没有关联笔记')).toBeNull();
  expect(screen.getByTestId('nav-title').props.children).toBe('群笔记');

  await act(async () => { rejectMembers(new Error('offline')); });
  expect(screen.getByText('member-read-only')).toBeTruthy();
  expect(screen.queryByText('本群还没有关联笔记')).toBeNull();
  expect(mockReadOnlyMounts).toHaveBeenCalledTimes(1);
});

test('a first load failure shows the retry page instead of the owner view', async () => {
  mockFetchMembers.mockRejectedValueOnce(new Error('offline'));
  render(<NoteManagementScreen />);
  await waitFor(() => expect(screen.getByText('common.retry')).toBeTruthy());
  expect(screen.queryByText('本群还没有关联笔记')).toBeNull();
  expect(screen.queryByText('member-read-only')).toBeNull();
});
