import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useGroupMemberViewAccess } from './use-group-member-view-access';
import {
  loadSpecifiedGroupMembers,
  subscribeGroupMemberSelfChanges,
} from '@/im/client';
import type { GroupMemberItem } from '@openim/rn-client-sdk';

jest.mock('@/im/client', () => ({
  loadSpecifiedGroupMembers: jest.fn(),
  subscribeGroupMemberSelfChanges: jest.fn(),
}));

const mockLoadSpecifiedGroupMembers = loadSpecifiedGroupMembers as jest.Mock;
const mockSubscribe = subscribeGroupMemberSelfChanges as jest.Mock;

const GROUP_ID = 'group-1';
const USER_ID = 'user1111';

function memberWithRole(roleLevel: number) {
  return { groupID: GROUP_ID, userID: USER_ID, roleLevel } as GroupMemberItem;
}

describe('useGroupMemberViewAccess', () => {
  let subscribedCallback: ((member: GroupMemberItem | null) => void) | null;
  let unsubscribe: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    subscribedCallback = null;
    unsubscribe = jest.fn();
    mockSubscribe.mockImplementation((_groupID, _userID, onChange) => {
      subscribedCallback = onChange;
      return unsubscribe;
    });
  });

  function renderAccessHook() {
    return renderHook(() =>
      useGroupMemberViewAccess({
        enabled: true,
        groupID: GROUP_ID,
        currentUserID: USER_ID,
      }),
    );
  }

  it('grants access to a mounted admin and revokes it live on demotion to member', async () => {
    mockLoadSpecifiedGroupMembers.mockResolvedValue([memberWithRole(60)]);

    const { result } = renderAccessHook();
    await waitFor(() => expect(result.current.canViewMembers).toBe(true));

    // 群主在本页存活期间撤掉管理员 → onGroupMemberInfoChanged 推送新角色。
    act(() => {
      subscribedCallback?.(memberWithRole(20));
    });

    expect(result.current.canViewMembers).toBe(false);
  });

  it('revokes access live when the member is removed from the group', async () => {
    mockLoadSpecifiedGroupMembers.mockResolvedValue([memberWithRole(100)]);

    const { result } = renderAccessHook();
    await waitFor(() => expect(result.current.canViewMembers).toBe(true));

    act(() => {
      subscribedCallback?.(null);
    });

    expect(result.current.canViewMembers).toBe(false);
  });

  it('unsubscribes from role updates on unmount', async () => {
    mockLoadSpecifiedGroupMembers.mockResolvedValue([memberWithRole(60)]);

    const { unmount } = renderAccessHook();
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('revalidate fails closed when the live lookup errors', async () => {
    mockLoadSpecifiedGroupMembers.mockResolvedValue([memberWithRole(60)]);

    const { result } = renderAccessHook();
    await waitFor(() => expect(result.current.canViewMembers).toBe(true));

    mockLoadSpecifiedGroupMembers.mockRejectedValue(new Error('offline'));

    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await result.current.revalidate();
    });

    expect(allowed).toBe(false);
    expect(result.current.canViewMembers).toBe(false);
  });

  it('revalidate re-grants access when the live role is still privileged', async () => {
    mockLoadSpecifiedGroupMembers.mockResolvedValue([memberWithRole(60)]);

    const { result } = renderAccessHook();
    await waitFor(() => expect(result.current.canViewMembers).toBe(true));

    let allowed: boolean | undefined;
    await act(async () => {
      allowed = await result.current.revalidate();
    });

    expect(allowed).toBe(true);
    expect(result.current.canViewMembers).toBe(true);
  });

  it('stays fail-closed while disabled or unresolved', () => {
    mockLoadSpecifiedGroupMembers.mockResolvedValue([memberWithRole(100)]);

    const { result } = renderHook(() =>
      useGroupMemberViewAccess({
        enabled: false,
        groupID: GROUP_ID,
        currentUserID: USER_ID,
      }),
    );

    expect(result.current.canViewMembers).toBe(false);
    // disabled 场景没有查询要等，直接视为已落定，调用方不至于卡在加载态。
    expect(result.current.resolved).toBe(true);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('exposes the live self member and resolves after the initial lookup', async () => {
    mockLoadSpecifiedGroupMembers.mockResolvedValue([memberWithRole(60)]);

    const { result } = renderAccessHook();
    // 首查未落定前 resolved=false——调用方显示加载态而不是受限文案。
    expect(result.current.resolved).toBe(false);
    expect(result.current.selfMember).toBeNull();

    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.selfMember).toEqual(memberWithRole(60));

    // 订阅推送角色变化 → selfMember 同步更新（群昵称/角色徽标都吃它）。
    act(() => {
      subscribedCallback?.(memberWithRole(20));
    });
    expect(result.current.selfMember).toEqual(memberWithRole(20));
    expect(result.current.canViewMembers).toBe(false);
  });
});
