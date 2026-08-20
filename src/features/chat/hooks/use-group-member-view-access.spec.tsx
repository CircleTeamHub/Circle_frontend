import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useGroupMemberViewAccess } from './use-group-member-view-access';
import { fetchCircleDetail } from '@/services/api/circles';

jest.mock('@/services/api/circles', () => ({
  fetchCircleDetail: jest.fn(),
}));

const mockFetchCircleDetail = fetchCircleDetail as jest.Mock;

const GROUP_ID = 'circle-1';
const USER_ID = 'user-1';

function circleWithRole(
  myRole: 'OWNER' | 'ADMIN' | 'MEMBER' | null,
  myStatus: 'ACTIVE' | 'PENDING' | null = 'ACTIVE',
) {
  return { id: GROUP_ID, myRole, myStatus };
}

describe('useGroupMemberViewAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function renderAccessHook(enabled = true) {
    return renderHook(() =>
      useGroupMemberViewAccess({
        enabled,
        groupID: GROUP_ID,
        currentUserID: USER_ID,
      }),
    );
  }

  it('grants directory access to circle owners and admins', async () => {
    mockFetchCircleDetail.mockResolvedValue(circleWithRole('ADMIN'));
    const { result } = renderAccessHook();
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.canViewMembers).toBe(true);
    expect(result.current.selfMember).toMatchObject({
      role: 'ADMIN',
      roleLevel: 60,
      userID: USER_ID,
    });
  });

  it('denies plain members and non-active memberships', async () => {
    mockFetchCircleDetail.mockResolvedValue(circleWithRole('MEMBER'));
    const { result } = renderAccessHook();
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.canViewMembers).toBe(false);

    mockFetchCircleDetail.mockResolvedValue(circleWithRole('OWNER', 'PENDING'));
    const second = renderAccessHook();
    await waitFor(() => expect(second.result.current.resolved).toBe(true));
    expect(second.result.current.canViewMembers).toBe(false);
    expect(second.result.current.selfMember).toBeNull();
  });

  it('fails closed when the role query rejects', async () => {
    mockFetchCircleDetail.mockRejectedValue(new Error('network down'));
    const { result } = renderAccessHook();
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.canViewMembers).toBe(false);
    expect(result.current.selfMember).toBeNull();
  });

  it('revalidate re-queries live and fails closed on error', async () => {
    mockFetchCircleDetail.mockResolvedValue(circleWithRole('ADMIN'));
    const { result } = renderAccessHook();
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.canViewMembers).toBe(true);

    // 现场撤权:revalidate 立即按最新角色拒绝,不吃挂载期的旧快照。
    mockFetchCircleDetail.mockResolvedValue(circleWithRole('MEMBER'));
    await act(async () => {
      await expect(result.current.revalidate()).resolves.toBe(false);
    });

    mockFetchCircleDetail.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await expect(result.current.revalidate()).resolves.toBe(false);
    });
  });

  it('resolves immediately without querying when disabled', async () => {
    const { result } = renderAccessHook(false);
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(mockFetchCircleDetail).not.toHaveBeenCalled();
    expect(result.current.canViewMembers).toBe(false);
  });
});
