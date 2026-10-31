import { apiClient } from "./client";
import { markGroupWrite } from "./group-writes";
export type GroupAdmissionStatus =
  "INVITED" | "PENDING" | "JOINED" | "DECLINED" | "REJECTED" | "EXPIRED" | "LEFT";
export interface GroupAdmission {
  requiresApproval?: boolean;
  id: string;
  conversationId: string;
  applicantId: string;
  inviterId: string | null;
  kind: "INVITE" | "QR" | "APPLICATION";
  status: GroupAdmissionStatus;
  reason: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt?: string;
}
export interface GroupPreview {
  id: string;
  name: string;
  avatarUrl: string | null;
  memberCount: number;
  isMember: boolean;
  canManage: boolean;
  cardJoinEnabled: boolean;
  joinApprovalRequired: boolean;
  admission: GroupAdmission | null;
  unavailable?: boolean;
  circleId?: string;
}
export interface GroupAdmissionDetail extends GroupAdmission {
  unreadCount?: number;
  group: GroupPreview;
  applicantName: string;
  inviterName: string;
  isApplicant: boolean;
}
export type GroupAdmissionAction = "accept" | "decline" | "approve" | "reject";
export function fetchGroupPreview(id: string) {
  return apiClient<GroupPreview>(
    `/chat/groups/${encodeURIComponent(id)}/preview`,
  );
}
export function fetchGroupAdmission(id: string) {
  return apiClient<GroupAdmissionDetail>(
    `/chat/group-admissions/${encodeURIComponent(id)}`,
  );
}
export function applyToGroup(id: string, reason: string) {
  return markGroupWrite(apiClient(`/chat/groups/${encodeURIComponent(id)}/applications`, {
    method: "POST",
    body: { reason },
  }));
}
export function actOnGroupAdmission(id: string, action: GroupAdmissionAction) {
  return markGroupWrite(apiClient<GroupAdmissionDetail>(
    `/chat/group-admissions/${encodeURIComponent(id)}/action`,
    { method: "POST", body: { action } },
  ));
}
export function fetchGroupAdmissions(cursor?: string, groupId?: string) {
  return apiClient<{
    items: GroupAdmissionDetail[];
    nextCursor: string | null;
  }>(
    `/chat/group-admissions?${new URLSearchParams({ ...(cursor ? { cursor } : {}), ...(groupId ? { groupId } : {}) }).toString()}`,
  );
}
export function acceptGroupQrInvitation(token: string) {
  return markGroupWrite(apiClient<{
    type: "GROUP";
    status: "JOINED" | "PENDING";
    conversationId?: string;
    admissionId?: string;
  }>(`/qr/tokens/${encodeURIComponent(token)}/accept`, { method: "POST" }));
}
let unreadGeneration = 0;
export async function refreshGroupAdmissionUnread() {
  const { useTabBadgeStore } = await import("@/stores/tabBadgeStore");
  const { useAuthStore } = await import("@/stores/authStore");
  const epoch = useAuthStore.getState().sessionEpoch;
  const generation = ++unreadGeneration;
  const result = await apiClient<{ count: number }>(
    "/chat/group-admissions/unread",
  );
  if (
    generation === unreadGeneration &&
    useAuthStore.getState().sessionEpoch === epoch &&
    Number.isFinite(result.count) &&
    result.count >= 0
  )
    useTabBadgeStore.getState().setGroupAdmissionsUnread(result.count);
}
export async function markGroupAdmissionSeen(id: string) {
  await markGroupWrite(apiClient(`/chat/group-admissions/${encodeURIComponent(id)}/seen`, {
    method: "POST",
  }));
  const { useNotificationCenterStore } =
    await import("@/features/notifications/store/use-notification-center-store");
  const store = useNotificationCenterStore.getState();
  for (const notification of store.interactive)
    if (notification.fromGroupAdmission?.id === id)
      store.markInteractiveReadLocal(notification.id);
  await refreshGroupAdmissionUnread();
}
