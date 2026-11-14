import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import GroupManagementScreen from './GroupManagementScreen';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import {
  fetchConversationGroups,
  updateConversationGroup,
} from '@/services/api/conversation-groups';
import type { CustomConversationGroup } from '@/types';

const mockRouter = { back: jest.fn(), push: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => (opts?.name ? `${key}:${opts.name}` : key),
  }),
}));
jest.mock('@/theme', () => ({
  Radius: { md: 12, pill: 26 },
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  Typography: { body: {}, small: {} },
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#fff', text: '#111', textSecondary: '#666',
      primary: '#00f', white: '#fff', black: '#000', error: '#f00',
    },
  }),
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
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

function makeGroup(overrides: Partial<CustomConversationGroup>): CustomConversationGroup {
  return {
    id: 'g-1',
    name: '家人',
    sortOrder: 0,
    pinnedToTabs: true,
    conversationIDs: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const family = makeGroup({ id: 'g-1', name: '家人', sortOrder: 0, conversationIDs: ['c-1', 'c-2'] });
const work = makeGroup({ id: 'g-2', name: '工作', sortOrder: 1, pinnedToTabs: false });
const alertSpy = jest.spyOn(Alert, 'alert');

const rowLabels = () =>
  screen
    .getAllByRole('adjustable')
    .map((node) => String(node.props.accessibilityLabel).replace('messages.groups.reorderA11y:', ''));
const moveRow = async (label: string, actionName: 'increment' | 'decrement') => {
  await act(async () => {
    fireEvent(
      screen.getByLabelText(`messages.groups.reorderA11y:${label}`),
      'accessibilityAction',
      { nativeEvent: { actionName } },
    );
  });
};

async function renderScreen(filterOrder: string[] = []) {
  useMessageGroupsStore.setState({ groups: [family, work], filterOrder, loading: false, error: null });
  jest.mocked(fetchConversationGroups).mockResolvedValue([family, work]);
  render(<GroupManagementScreen />);
  await act(async () => {});
}

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy.mockImplementation(() => undefined);
});

test('built-in tabs and every custom group sit in one list, in the saved order', async () => {
  await renderScreen(['custom:g-2', 'all']);

  expect(rowLabels()).toEqual([
    '工作',
    'messages.all',
    'messages.unread',
    'messages.group',
    'messages.private',
    '家人',
  ]);
  expect(screen.getByText('messages.groups.conversationCount · messages.groups.hiddenFromTabs')).toBeTruthy();
  expect(screen.getAllByText('messages.groups.builtInGroup')).toHaveLength(4);
});

test('custom groups open their editor, built-in tabs do not, and the footer starts a new group', async () => {
  await renderScreen();

  fireEvent.press(screen.getByText('家人'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({
    pathname: '/(tabs)/messages/group-edit',
    params: { id: 'g-1' },
  });

  mockRouter.push.mockClear();
  fireEvent.press(screen.getByText('messages.unread'));
  expect(mockRouter.push).not.toHaveBeenCalled();

  fireEvent.press(screen.getByText('messages.groups.create'));
  expect(mockRouter.push).toHaveBeenLastCalledWith('/(tabs)/messages/group-edit');
});

test('moving a built-in tab is saved on the device only', async () => {
  await renderScreen();

  await moveRow('messages.all', 'increment');

  expect(rowLabels().slice(0, 2)).toEqual(['messages.unread', 'messages.all']);
  expect(useMessageGroupsStore.getState().filterOrder.slice(0, 2)).toEqual(['unread', 'all']);
  expect(updateConversationGroup).not.toHaveBeenCalled();
});

test('moving a group past another group also saves the new group order to the server', async () => {
  jest
    .mocked(updateConversationGroup)
    .mockImplementation(async (id, patch) =>
      makeGroup({ ...(id === 'g-1' ? family : work), sortOrder: patch.sortOrder ?? 0 }),
    );
  await renderScreen();

  await moveRow('工作', 'decrement');

  expect(rowLabels().slice(-2)).toEqual(['工作', '家人']);
  expect(updateConversationGroup).toHaveBeenCalledWith('g-2', { sortOrder: 0 });
  expect(updateConversationGroup).toHaveBeenCalledWith('g-1', { sortOrder: 1 });
  expect(alertSpy).not.toHaveBeenCalled();
});

test('if the server rejects the new group order, the whole list goes back and the user is told', async () => {
  jest.mocked(updateConversationGroup).mockRejectedValue(new Error('network'));
  await renderScreen(['all', 'unread', 'group', 'private', 'custom:g-1', 'custom:g-2']);

  await moveRow('工作', 'decrement');

  expect(alertSpy).toHaveBeenCalledWith(
    'messages.groups.reorderFailedTitle',
    'messages.groups.reorderFailedMessage',
  );
  expect(rowLabels().slice(-2)).toEqual(['家人', '工作']);
  expect(useMessageGroupsStore.getState().filterOrder).toEqual([
    'all',
    'unread',
    'group',
    'private',
    'custom:g-1',
    'custom:g-2',
  ]);
});
