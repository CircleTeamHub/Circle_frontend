import { apiClient } from '@/services/api/client';
import { buildQuery, normalizeMediaUrl } from '@/services/api/utils';
import type {
  Circle,
  CircleDetail,
  CircleInvitation,
  CreateCircleInput,
  MyCircle,
} from '@/types';
import { collectCursorPages } from './collect-cursor-pages';

const MY_CIRCLES_PAGE_SIZE = 100;

// 泛型：保留调用方的具体类型（如 MyCircle 的 myRole），不要窄化成 Circle。
function normalizeCircle<T extends Circle>(circle: T): T {
  return {
    ...circle,
    avatarUrl: circle.avatarUrl ? normalizeMediaUrl(circle.avatarUrl) : null,
    cover: circle.cover ? normalizeMediaUrl(circle.cover) : null,
    currentIconUrl: circle.currentIconUrl
      ? normalizeMediaUrl(circle.currentIconUrl)
      : null,
  };
}

// ── Circle CRUD ──────────────────────────────────────────────────────────────

export async function fetchCircles(params?: {
  city?: string;
  page?: number;
  limit?: number;
}) {
  const result = await apiClient<{
    items: Circle[];
    total: number;
    page: number;
    limit: number;
  }>(`/circle${buildQuery(params ?? {})}`);

  return {
    ...result,
    items: result.items.map(normalizeCircle),
  };
}

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
    availableIconAssets:
      detail.availableIconAssets?.map((asset) => ({
        ...asset,
        imageUrl: asset.imageUrl ? normalizeMediaUrl(asset.imageUrl) : null,
      })) ?? [],
  };
}

export async function createCircle(
  input: CreateCircleInput,
): Promise<CircleDetail> {
  return apiClient<CircleDetail>('/circle', {
    method: 'POST',
    body: (input),
  });
}

export async function updateCircle(
  id: string,
  input: Partial<CreateCircleInput>,
): Promise<CircleDetail> {
  const detail = await apiClient<CircleDetail>(`/circle/${id}`, {
    method: 'PATCH',
    body: input,
  });

  return {
    ...normalizeCircle(detail),
    myRole: detail.myRole,
    myStatus: detail.myStatus,
  };
}

export async function joinCircle(id: string): Promise<void> {
  await apiClient<void>(`/circle/${id}/join`, { method: 'POST' });
}

export async function leaveCircle(id: string): Promise<void> {
  await apiClient<void>(`/circle/${id}/leave`, { method: 'DELETE' });
}

export async function uploadCircleIcon(
  id: string,
  input: { imageUrl: string; name?: string },
) {
  return apiClient<{ id: string; name: string; imageUrl: string | null }>(
    `/circle/${id}/icon/upload`,
    {
      method: 'POST',
      body: input,
    },
  );
}

export async function selectCircleIcon(
  id: string,
  iconAssetId: string,
): Promise<void> {
  await apiClient<void>(`/circle/${id}/icon/select`, {
    method: 'POST',
    body: { iconAssetId },
  });
}

export async function setCircleCover(id: string, cover: string): Promise<void> {
  await apiClient<void>(`/circle/${id}/cover`, {
    method: 'POST',
    body: { cover },
  });
}

export async function setCircleAvatar(
  id: string,
  avatarUrl: string,
): Promise<void> {
  await apiClient<void>(`/circle/${id}/avatar`, {
    method: 'POST',
    body: { avatarUrl },
  });
}

// ── Invitation / Verification ────────────────────────────────────────────────

export async function inviteToCircle(
  circleId: string,
  applicantId: string,
): Promise<CircleInvitation> {
  return apiClient<CircleInvitation>('/circle-invitation/invite', {
    method: 'POST',
    body: ({ circleId, applicantId }),
  });
}

export async function fetchInvitation(
  invitationId: string,
): Promise<CircleInvitation> {
  return apiClient<CircleInvitation>(`/circle-invitation/${invitationId}`);
}

export async function addVerifierToInvitation(
  invitationId: string,
  verifierId: string,
): Promise<void> {
  await apiClient<void>(`/circle-invitation/${invitationId}/add-verifier`, {
    method: 'POST',
    body: ({ verifierId }),
  });
}

export async function respondToVerification(
  invitationId: string,
  approve: boolean,
): Promise<void> {
  await apiClient<void>(`/circle-invitation/${invitationId}/respond`, {
    method: 'POST',
    body: ({ approve }),
  });
}

export async function adminApproveInvitation(
  invitationId: string,
): Promise<void> {
  await apiClient<void>(`/circle-invitation/${invitationId}/admin-approve`, {
    method: 'POST',
  });
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
