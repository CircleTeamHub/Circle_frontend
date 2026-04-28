import { apiClient } from '@/services/api/client';
import { normalizeMediaUrl } from '@/services/api/utils';
import type {
  Circle,
  CircleActivityItem,
  CircleDetail,
  CircleInvitation,
  CreateCircleInput,
} from '@/types';

function normalizeCircle(circle: Circle): Circle {
  return {
    ...circle,
    avatarUrl: circle.avatarUrl ? normalizeMediaUrl(circle.avatarUrl) : null,
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
  const query = new URLSearchParams();
  if (params?.city) query.set('city', params.city);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const qs = query.toString();
  const result = await apiClient<{
    items: Circle[];
    total: number;
    page: number;
    limit: number;
  }>(`/circle${qs ? `?${qs}` : ''}`);

  return {
    ...result,
    items: result.items.map(normalizeCircle),
  };
}

export async function fetchMyCircles(
  tab: 'joined' | 'created' | 'applied',
): Promise<Circle[]> {
  const circles = await apiClient<Circle[]>(`/circle/my?tab=${tab}`);
  return circles.map(normalizeCircle);
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

// ── Circle Activities ────────────────────────────────────────────────────────

export async function fetchCircleActivities(): Promise<CircleActivityItem[]> {
  return apiClient<CircleActivityItem[]>('/circle/activities/list');
}

export async function fetchCircleActivityUnreadCount(): Promise<number> {
  const result = await apiClient<{ count: number }>(
    '/circle/activities/unread-count',
  );
  return result.count;
}

export async function markCircleActivityRead(
  activityId: string,
): Promise<void> {
  await apiClient<void>(`/circle/activities/${activityId}/read`, {
    method: 'POST',
  });
}
