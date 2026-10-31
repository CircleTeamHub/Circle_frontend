import { apiClient } from '@/services/api/client';
import { allowPeerMediaUrl, buildQuery } from '@/services/api/utils';
import type {
  Circle,
  CircleDetail,
  CircleInvitation,
  CircleInvitationUser,
  CreateCircleInput,
  MyCircle,
} from '@/types';
import { collectCursorPages } from './collect-cursor-pages';

let lastCircleMutationAt = 0;

/**
 * 圈子相关的写请求(建圈/编辑/加入/退出/解散/邀请/验证…)成功后记一笔。发现页、圈子详情
 * 回到前台时据此判断能不能跳过重拉:拉过之后改过任何东西就必须重拉。宁可多拉,不显示旧数据。
 * 包的是 Promise 而不是 apiClient 本身:每个调用点仍然是静态路径,诊断路由覆盖照常能扫到。
 */
async function markCircleWrite<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  lastCircleMutationAt = Date.now();
  return result;
}

/** since 之后有没有成功的圈子写请求。 */
export function circlesMutatedSince(since: number): boolean {
  return lastCircleMutationAt >= since;
}

const MY_CIRCLES_PAGE_SIZE = 100;

// 泛型：保留调用方的具体类型（如 MyCircle 的 myRole），不要窄化成 Circle。
function normalizeCircle<T extends Circle>(circle: T): T {
  return {
    ...circle,
    avatarUrl: circle.avatarUrl ? allowPeerMediaUrl(circle.avatarUrl) : null,
    cover: circle.cover ? allowPeerMediaUrl(circle.cover) : null,
    currentIconUrl: circle.currentIconUrl
      ? allowPeerMediaUrl(circle.currentIconUrl)
      : null,
  };
}

// ── Circle CRUD ──────────────────────────────────────────────────────────────

export async function fetchMyCircles(
  tab: 'joined' | 'created' | 'applied',
): Promise<MyCircle[]> {
  // myRole 随列表下发 —— 调用方不必再为角色逐个拉 /circle/:id。
  return collectCursorPages(
    async (cursor) => {
      const circles = await apiClient<MyCircle[]>(
        `/circle/my${buildQuery({
          tab,
          limit: MY_CIRCLES_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        })}`,
      );
      return circles.map(normalizeCircle);
    },
    MY_CIRCLES_PAGE_SIZE,
  );
}

export async function fetchCircleDetail(id: string): Promise<CircleDetail> {
  const detail = await apiClient<CircleDetail>(`/circle/${id}`);
  return {
    ...normalizeCircle(detail),
    myRole: detail.myRole,
    myStatus: detail.myStatus,
  };
}

export async function createCircle(
  input: CreateCircleInput,
): Promise<CircleDetail> {
  const detail = await markCircleWrite(apiClient<CircleDetail>('/circle', {
    method: 'POST',
    body: (input),
  }));
  return {
    ...normalizeCircle(detail),
    myRole: detail.myRole,
    myStatus: detail.myStatus,
  };
}

export async function updateCircle(
  id: string,
  input: Partial<CreateCircleInput>,
): Promise<CircleDetail> {
  const detail = await markCircleWrite(apiClient<CircleDetail>(`/circle/${id}`, {
    method: 'PATCH',
    body: input,
  }));

  return {
    ...normalizeCircle(detail),
    myRole: detail.myRole,
    myStatus: detail.myStatus,
  };
}

export async function joinCircle(id: string): Promise<void> {
  await markCircleWrite(apiClient<void>(`/circle/${id}/join`, { method: 'POST' }));
}

export async function leaveCircle(id: string): Promise<void> {
  await markCircleWrite(apiClient<void>(`/circle/${id}/leave`, { method: 'DELETE' }));
}

/**
 * 圈主解散圈子。圈主退不了圈(后端 CIRCLE_OWNER_CANNOT_LEAVE),要撤掉圈子
 * 只有这一条路:圈子从所有成员的列表里消失,群聊全员离座。不可逆。
 */
export async function dissolveCircle(id: string): Promise<void> {
  await markCircleWrite(apiClient<void>(`/circle/${id}`, { method: 'DELETE' }));
}

export async function uploadCircleIcon(
  id: string,
  input: { imageUrl: string; name?: string },
) {
  const result = await markCircleWrite(apiClient<{ id: string; name: string; imageUrl: string | null }>(
    `/circle/${id}/icon/upload`,
    {
      method: 'POST',
      body: input,
    },
  ));
  return { ...result, imageUrl: allowPeerMediaUrl(result.imageUrl) };
}

export async function selectCircleIcon(
  id: string,
  iconAssetId: string,
): Promise<void> {
  await markCircleWrite(apiClient<void>(`/circle/${id}/icon/select`, {
    method: 'POST',
    body: { iconAssetId },
  }));
}

export async function setCircleCover(id: string, cover: string): Promise<void> {
  await markCircleWrite(apiClient<void>(`/circle/${id}/cover`, {
    method: 'POST',
    body: { cover },
  }));
}

export async function setCircleAvatar(
  id: string,
  avatarUrl: string,
): Promise<void> {
  await markCircleWrite(apiClient<void>(`/circle/${id}/avatar`, {
    method: 'POST',
    body: { avatarUrl },
  }));
}

// ── Invitation / Verification ────────────────────────────────────────────────

export async function inviteToCircle(
  circleId: string,
  applicantId: string,
): Promise<CircleInvitation> {
  return markCircleWrite(apiClient<CircleInvitation>('/circle-invitation/invite', {
    method: 'POST',
    body: ({ circleId, applicantId }),
  }));
}

export async function fetchInvitation(
  invitationId: string,
): Promise<CircleInvitation> {
  return apiClient<CircleInvitation>(`/circle-invitation/${invitationId}`);
}

/**
 * 申请人可挑的验证人 = 本圈 ACTIVE 成员 ∩ 自己的好友 - 已占席的 - 自己。
 *
 * 交集由服务端算(见 BE circle-invitation.service.getEligibleVerifiers)。这里
 * 刻意不用好友列表再做一遍过滤 —— 同一条资格规则写两份必然漂移,而漂移的表现
 * 是「列表里点得到、点下去被打回」。
 */
export async function fetchEligibleVerifiers(
  invitationId: string,
): Promise<CircleInvitationUser[]> {
  const list = await apiClient<CircleInvitationUser[]>(
    `/circle-invitation/${invitationId}/eligible-verifiers`,
  );
  return list.map((user) => ({
    ...user,
    avatarUrl: allowPeerMediaUrl(user.avatarUrl),
  }));
}

export async function addVerifierToInvitation(
  invitationId: string,
  verifierId: string,
): Promise<void> {
  await markCircleWrite(apiClient<void>(`/circle-invitation/${invitationId}/add-verifier`, {
    method: 'POST',
    body: ({ verifierId }),
  }));
}

export async function respondToVerification(
  invitationId: string,
  approve: boolean,
): Promise<void> {
  await markCircleWrite(apiClient<void>(`/circle-invitation/${invitationId}/respond`, {
    method: 'POST',
    body: ({ approve }),
  }));
}

export async function adminApproveInvitation(
  invitationId: string,
): Promise<void> {
  await markCircleWrite(apiClient<void>(`/circle-invitation/${invitationId}/admin-approve`, {
    method: 'POST',
  }));
}

export async function fetchMyPendingVerifications(): Promise<
  CircleInvitation[]
> {
  return apiClient<CircleInvitation[]>('/circle-invitation/pending');
}

export async function fetchMyApplications(): Promise<CircleInvitation[]> {
  return apiClient<CircleInvitation[]>('/circle-invitation/my-applications');
}

export async function fetchPendingInvitationsForCircle(
  circleId: string,
): Promise<CircleInvitation[]> {
  return apiClient<CircleInvitation[]>(
    `/circle-invitation/circle/${circleId}/pending`,
  );
}

export function respondToCircleInvitation(id: string, accept: boolean): Promise<CircleInvitation> {
  if (accept) return markCircleWrite(apiClient(`/circle-invitation/${encodeURIComponent(id)}/accept`, { method: 'POST' }));
  return markCircleWrite(apiClient(`/circle-invitation/${encodeURIComponent(id)}/decline`, { method: 'POST' }));
}

export function markCircleInvitationSeen(id: string) { return markCircleWrite(apiClient(`/circle-invitation/${encodeURIComponent(id)}/seen`, { method: 'POST' })); }
