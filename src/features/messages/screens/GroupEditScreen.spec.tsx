import React from 'react';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { usePreventRemove } from '@react-navigation/native';
import GroupEditScreen from './GroupEditScreen';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import {
  createConversationGroup,
  deleteConversationGroup,
  setConversationGroupMembers,
  updateConversationGroup,
} from '@/services/api/conversation-groups';
import type { CustomConversationGroup } from '@/types';

const mockRouter = { back: jest.fn(), push: jest.fn() };
const mockNavigation = { dispatch: jest.fn() };
let mockParams: { id?: string } = {};
const mockConversations = [
  { id: 'c-1', name: '读书会', conversationType: 'group', avatarUrl: undefined },
  { id: 'c-2', name: '张三', conversationType: 'private', avatarUrl: undefined },
];

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useNavigation: () => mockNavigation,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@react-navigation/native', () => ({ usePreventRemove: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/theme', () => ({
  Radius: { md: 12, pill: 26 },
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  Typography: { body: {}, bodyRegular: {}, caption: {}, small: {} },
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111',
      textSecondary: '#666', primary: '#00f', white: '#fff', error: '#f00',
      iconAccent: '#00f', switchOffTrack: '#ccc',
    },
  }),
}));
jest.mock('@/components/ui/nav-header', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NavHeader: ({ title, rightSlot }: { title: string; rightSlot?: React.ReactNode }) => (
      <>
        <MockText>{title}</MockText>
        {rightSlot}
      </>
    ),
  };
});
jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  const { View: MockView } = jest.requireActual<typeof import('react-native')>('react-native');
  return { KeyboardAvoidingContainer: MockView };
});
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/hooks/use-deferred-content', () => ({ useDeferredContent: () => true }));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (select: (state: { conversations: unknown[] }) => unknown) =>
    select({ conversations: mockConversations }),
}));
jest.mock('@/chat-core/mappers', () => ({ mapChatConversationToUI: (c: unknown) => c }));
jest.mock('@/services/api/conversation-groups', () => ({
  fetchConversationGroups: jest.fn(),
  createConversationGroup: jest.fn(),
  updateConversationGroup: jest.fn(),
  deleteConversationGroup: jest.fn(),
  setConversationGroupMembers: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key },
}));
jest.mock('@/storage', () => ({
  mmkvJsonStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
}));

function makeGroup(overrides: Partial<CustomConversationGroup> = {}): CustomConversationGroup {
  return {
    id: 'g-1',
    name: '家人',
    sortOrder: 0,
    pinnedToTabs: true,
    conversationIDs: ['c-1'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const alertSpy = jest.spyOn(Alert, 'alert');
const pressAlertButton = (style: AlertButton['style']) => {
  const buttons = alertSpy.mock.calls.at(-1)?.[2] ?? [];
  act(() => {
    buttons.find((button) => button.style === style)?.onPress?.();
  });
};
const latestGuard = () => jest.mocked(usePreventRemove).mock.calls.at(-1)!;
const pressSave = async (label = 'common.save') => {
  await act(async () => {
    fireEvent.press(screen.getByText(label));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy.mockImplementation(() => undefined);
  mockParams = {};
  useMessageGroupsStore.setState({ groups: [], filterOrder: [], error: null, loading: false });
});

test('a new group is created with its name and chosen chats in one save, then the page closes', async () => {
  jest.mocked(createConversationGroup).mockResolvedValue(
    makeGroup({ id: 'g-new', name: '读书', conversationIDs: [] }),
  );
  jest.mocked(setConversationGroupMembers).mockResolvedValue(
    makeGroup({ id: 'g-new', name: '读书', conversationIDs: ['c-1', 'c-2'] }),
  );
  render(<GroupEditScreen />);

  expect(screen.getByRole('button', { name: 'common.create' })).toBeDisabled();
  fireEvent.changeText(screen.getByPlaceholderText('messages.groups.namePlaceholder'), ' 读书 ');
  fireEvent.press(screen.getByText('读书会'));
  fireEvent.press(screen.getByText('张三'));
  await pressSave('common.create');

  expect(createConversationGroup).toHaveBeenCalledWith({
    name: '读书',
    pinnedToTabs: true,
    sortOrder: 0,
  });
  expect(setConversationGroupMembers).toHaveBeenCalledWith('g-new', ['c-1', 'c-2']);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('when the chats fail to save after the group was created, saving again only retries the chats', async () => {
  jest.mocked(createConversationGroup).mockResolvedValue(
    makeGroup({ id: 'g-new', name: '读书', conversationIDs: [] }),
  );
  jest
    .mocked(setConversationGroupMembers)
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(makeGroup({ id: 'g-new', name: '读书', conversationIDs: ['c-2'] }));
  render(<GroupEditScreen />);

  fireEvent.changeText(screen.getByPlaceholderText('messages.groups.namePlaceholder'), '读书');
  fireEvent.press(screen.getByText('张三'));
  await pressSave('common.create');

  expect(alertSpy).toHaveBeenLastCalledWith(
    'messages.groups.saveFailed',
    'messages.groups.membersFailedAfterCreate',
  );
  expect(mockRouter.back).not.toHaveBeenCalled();

  await pressSave();

  expect(createConversationGroup).toHaveBeenCalledTimes(1);
  expect(setConversationGroupMembers).toHaveBeenLastCalledWith('g-new', ['c-2']);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('renaming and hiding a group is one PATCH, and untouched chats are not rewritten', async () => {
  useMessageGroupsStore.setState({ groups: [makeGroup()] });
  mockParams = { id: 'g-1' };
  jest.mocked(updateConversationGroup).mockResolvedValue(
    makeGroup({ name: '家里人', pinnedToTabs: false }),
  );
  render(<GroupEditScreen />);

  expect(screen.getByText('messages.groups.editTitle')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
  fireEvent.changeText(screen.getByDisplayValue('家人'), '家里人');
  fireEvent(screen.getByLabelText('messages.groups.showInTabs'), 'valueChange', false);
  await pressSave();

  expect(updateConversationGroup).toHaveBeenCalledTimes(1);
  expect(updateConversationGroup).toHaveBeenCalledWith('g-1', {
    name: '家里人',
    pinnedToTabs: false,
  });
  expect(setConversationGroupMembers).not.toHaveBeenCalled();
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('leaving with unsaved changes asks first; after a save the exit goes straight through', async () => {
  useMessageGroupsStore.setState({ groups: [makeGroup()] });
  mockParams = { id: 'g-1' };
  jest.mocked(setConversationGroupMembers).mockResolvedValue(
    makeGroup({ conversationIDs: ['c-1', 'c-2'] }),
  );
  render(<GroupEditScreen />);
  expect(latestGuard()[0]).toBe(false);

  fireEvent.press(screen.getByText('张三'));
  expect(latestGuard()[0]).toBe(true);
  const back = { type: 'GO_BACK' };
  act(() => latestGuard()[1]({ data: { action: back } } as never));
  expect(alertSpy).toHaveBeenLastCalledWith(
    'messages.groups.discardTitle',
    'messages.groups.discardMessage',
    expect.any(Array),
  );
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  pressAlertButton('destructive');
  expect(mockNavigation.dispatch).toHaveBeenCalledWith(back);
});

test('back is held while a save is in flight; once saved, the page closes exactly once', async () => {
  useMessageGroupsStore.setState({ groups: [makeGroup()] });
  mockParams = { id: 'g-1' };
  let finishSave: (group: CustomConversationGroup) => void = () => undefined;
  jest.mocked(updateConversationGroup).mockImplementation(
    () => new Promise((resolve) => { finishSave = resolve; }),
  );
  render(<GroupEditScreen />);

  fireEvent.changeText(screen.getByDisplayValue('家人'), '家里人');
  await pressSave();
  expect(screen.getByText('common.saving')).toBeTruthy();
  expect(latestGuard()[0]).toBe(true);
  act(() => latestGuard()[1]({ data: { action: { type: 'GO_BACK' } } } as never));
  expect(alertSpy).not.toHaveBeenCalled();
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();

  // 真机上 router.back() 触发的拦截会拿到保存中那一帧的守卫（saving 还是 true）：必须放行。
  const guardWhileSaving = latestGuard()[1];
  await act(async () => finishSave(makeGroup({ name: '家里人' })));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  act(() => guardWhileSaving({ data: { action: { type: 'GO_BACK' } } } as never));
  expect(mockNavigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  expect(alertSpy).not.toHaveBeenCalled();
});

test('deleting confirms first, returns to the list, then removes the group', async () => {
  useMessageGroupsStore.setState({
    groups: [makeGroup()],
    filterOrder: ['custom:g-1', 'all'],
  });
  mockParams = { id: 'g-1' };
  jest.mocked(deleteConversationGroup).mockResolvedValue(undefined);
  render(<GroupEditScreen />);

  fireEvent.press(screen.getByText('messages.groups.deleteTitle'));
  expect(deleteConversationGroup).not.toHaveBeenCalled();
  await act(async () => {
    pressAlertButton('destructive');
  });

  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(deleteConversationGroup).toHaveBeenCalledWith('g-1');
  expect(useMessageGroupsStore.getState().groups).toEqual([]);
  expect(useMessageGroupsStore.getState().filterOrder).toEqual(['all']);
});

test('a new group has no delete button, and a group deleted elsewhere shows a notice', () => {
  const { unmount } = render(<GroupEditScreen />);
  expect(screen.queryByText('messages.groups.deleteTitle')).toBeNull();
  unmount();

  mockParams = { id: 'gone' };
  render(<GroupEditScreen />);
  expect(screen.getByText('messages.groups.notFound')).toBeTruthy();
  expect(screen.queryByPlaceholderText('messages.groups.namePlaceholder')).toBeNull();
});
