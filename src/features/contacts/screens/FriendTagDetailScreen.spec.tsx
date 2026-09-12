import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import FriendTagDetailScreen from './FriendTagDetailScreen';
import {
  assignFriendTag,
  fetchFriends,
  fetchFriendsByTag,
  type FriendProfile,
} from '@/services/api/friends';

const mockRouter = { push: jest.fn() };
const mockTranslate = (key: string, options?: Record<string, string | number>) =>
  String(options?.defaultValue ?? key).replace(
    /\{\{(\w+)\}\}/g,
    (_match, name: string) => String(options?.[name] ?? ''),
  );
const alice: FriendProfile = {
  id: 'friend-1',
  accountId: 'alice',
  nickname: 'Alice',
  avatarUrl: null,
  avatarFrame: null,
  avatarFrameAppearance: null,
  gender: 'UNKNOWN',
  lastOnline: null,
  friendsSince: '2026-01-01T00:00:00.000Z',
  remark: null,
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'tag-1', name: '同事' }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/theme', () => ({
  Radius: { md: 12, full: 999, xl: 18, xxl: 24 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  Typography: {
    body: {}, bodyRegular: {}, caption: {}, h3: {}, small: {}, tiny: {},
  },
  useTheme: () => ({ colors: {
    background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111',
    textSecondary: '#666', primary: '#00f', iconAccent: '#00f', white: '#fff',
  } }),
}));

jest.mock('@/services/api/friends', () => ({
  assignFriendTag: jest.fn(),
  fetchFriends: jest.fn(),
  fetchFriendsByTag: jest.fn(),
}));

jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

jest.mock('@/components/ui/avatar', () => ({
  Avatar: () => null,
}));
jest.mock('@/components/ui/member-name', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    MemberName: ({ name }: { name: string }) => ReactModule.createElement(Text, null, name),
  };
});
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/nav-header', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NavHeader: ({ rightSlot }: { rightSlot?: ReactNode }) =>
      ReactModule.createElement(View, null, rightSlot),
  };
});
jest.mock('@/components/ui/bottom-sheet-modal', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
      visible ? ReactModule.createElement(View, null, children) : null,
  };
});
jest.mock('@/components/ui/keyboard-dismiss', () => ({ keyboardDismissOnDragProps: {} }));
jest.mock('@expo/vector-icons', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => ReactModule.createElement(Text, null, name),
  };
});

test('a stale tag load cannot remove a friend added while it is in flight', async () => {
  let resolveInitialLoad!: (friends: FriendProfile[]) => void;
  const initialLoad = new Promise<FriendProfile[]>((resolve) => {
    resolveInitialLoad = resolve;
  });
  jest.mocked(fetchFriendsByTag).mockReturnValueOnce(initialLoad).mockResolvedValue([]);
  jest.mocked(fetchFriends).mockResolvedValue([alice]);
  jest.mocked(assignFriendTag).mockResolvedValue(undefined);

  render(<FriendTagDetailScreen />);
  fireEvent.press(screen.getByLabelText('contacts.tagDetail.addFriends'));
  await waitFor(() => expect(fetchFriends).toHaveBeenCalledTimes(1));

  fireEvent.press(screen.getByLabelText('contacts.tagDetail.addFriendAction', { exact: false }));
  await waitFor(() => expect(assignFriendTag).toHaveBeenCalledWith('friend-1', 'tag-1'));

  await act(async () => {
    resolveInitialLoad([]);
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
  expect(screen.getAllByText('Alice')).toHaveLength(1);
});
