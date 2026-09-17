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

  function renderAccessHook(
    enabled = true,
    membersCanViewRoster: boolean | null = null,
  ) {
    return renderHook(() =>
      useGroupMemberViewAccess({
        enabled,
        groupID: GROUP_ID,
        currentUserID: USER_ID,
        membersCanViewRoster,
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

  it('allows ordinary members when the conversation opens the roster', async () => {
    mockFetchCircleDetail.mockResolvedValue(circleWithRole('MEMBER'));
    const { result } = renderAccessHook(true, true);
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.canViewMembers).toBe(true);
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

  describe('when it re-checks', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    function renderWith(props: { active?: boolean; roleHint?: string | null }) {
      return renderHook(
        (current: { active?: boolean; roleHint?: string | null }) =>
          useGroupMemberViewAccess({
            enabled: true,
            groupID: GROUP_ID,
            currentUserID: USER_ID,
            membersCanViewRoster: null,
            ...current,
          }),
        { initialProps: props },
      );
    }

    // 原来每 60 秒查一次圈子详情,页面被别的页面盖住也在查:开着一个群就是每小时
    // 60 次请求。现在只在页面在前台时兜底轮询,而且放慢到 5 分钟。
    it('does not poll while the screen is covered, and re-checks once it is back', async () => {
      jest.useFakeTimers();
      mockFetchCircleDetail.mockResolvedValue(circleWithRole('ADMIN'));
      const { result, rerender } = renderWith({ active: false });
      await waitFor(() => expect(result.current.resolved).toBe(true));
      expect(mockFetchCircleDetail).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(30 * 60_000);
      });
      expect(mockFetchCircleDetail).toHaveBeenCalledTimes(1);

      rerender({ active: true });
      await waitFor(() => expect(mockFetchCircleDetail).toHaveBeenCalledTimes(2));
    });

    it('falls back to a slow interval while active', async () => {
      jest.useFakeTimers();
      mockFetchCircleDetail.mockResolvedValue(circleWithRole('ADMIN'));
      const { result } = renderWith({ active: true });
      await waitFor(() => expect(result.current.resolved).toBe(true));

      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(mockFetchCircleDetail).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(4 * 60_000);
      });
      expect(mockFetchCircleDetail).toHaveBeenCalledTimes(2);
    });

    // 撤职/任命会刷新会话缓存里的角色:不用等下一次轮询。
    it('re-checks as soon as the cached conversation role changes', async () => {
      mockFetchCircleDetail.mockResolvedValue(circleWithRole('ADMIN'));
      const { result, rerender } = renderWith({ active: true, roleHint: 'ADMIN' });
      await waitFor(() => expect(result.current.canViewMembers).toBe(true));

      mockFetchCircleDetail.mockResolvedValue(circleWithRole('MEMBER'));
      rerender({ active: true, roleHint: 'MEMBER' });
      await waitFor(() => expect(result.current.canViewMembers).toBe(false));
      expect(mockFetchCircleDetail).toHaveBeenCalledTimes(2);
    });
  });
});
