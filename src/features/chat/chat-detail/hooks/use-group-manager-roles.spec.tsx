import { renderHook, waitFor } from '@testing-library/react-native';
import { fetchChatGroupManagers } from '@/chat-core/api';
import { reportHandledFailure } from '@/observability/report-failure';
import { useGroupManagerRoles } from './use-group-manager-roles';

jest.mock('@/chat-core/api', () => ({ fetchChatGroupManagers: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

const fetchManagers = jest.mocked(fetchChatGroupManagers);

beforeEach(() => {
  fetchManagers.mockReset();
  jest.mocked(reportHandledFailure).mockClear();
});

test('maps the group owner and admins by user id', async () => {
  fetchManagers.mockResolvedValue([
    { userId: 'u-owner', role: 'OWNER' },
    { userId: 'u-admin', role: 'ADMIN' },
  ]);
  const { result } = renderHook(() => useGroupManagerRoles('group-1', true));
  expect(result.current).toEqual({});
  await waitFor(() =>
    expect(result.current).toEqual({ 'u-owner': 'OWNER', 'u-admin': 'ADMIN' }),
  );
  expect(fetchManagers).toHaveBeenCalledWith('group-1');
});

test('reopening the same group shows the last known tags before the refetch lands', async () => {
  fetchManagers.mockResolvedValue([{ userId: 'u-owner', role: 'OWNER' }]);
  const first = renderHook(() => useGroupManagerRoles('group-2', true));
  await waitFor(() => expect(first.result.current).toEqual({ 'u-owner': 'OWNER' }));
  first.unmount();

  fetchManagers.mockReturnValue(new Promise(() => {}));
  const { result } = renderHook(() => useGroupManagerRoles('group-2', true));
  expect(result.current).toEqual({ 'u-owner': 'OWNER' });
  expect(fetchManagers).toHaveBeenCalledTimes(2);
});

test('does not ask when the chat is not a joined group', () => {
  const { result } = renderHook(() => useGroupManagerRoles('dm-1', false));
  expect(result.current).toEqual({});
  expect(fetchManagers).not.toHaveBeenCalled();
});

test('a failed lookup leaves the names untagged and is reported', async () => {
  const error = new Error('offline');
  fetchManagers.mockRejectedValue(error);
  const { result } = renderHook(() => useGroupManagerRoles('group-3', true));
  await waitFor(() =>
    expect(reportHandledFailure).toHaveBeenCalledWith('chatDetail', 'loadGroupManagers', error),
  );
  expect(result.current).toEqual({});
});
