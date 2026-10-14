import { groupAdmissionActions } from "./admission-actions";
import type { GroupAdmissionDetail } from "@/services/api/group-admissions";
const detail = (
  patch: Partial<GroupAdmissionDetail> = {},
): GroupAdmissionDetail => ({
  id: "i",
  conversationId: "g",
  applicantId: "u",
  inviterId: "v",
  kind: "INVITE",
  status: "INVITED",
  reason: "",
  expiresAt: "",
  acceptedAt: null,
  createdAt: "",
  group: {
    id: "g",
    name: "G",
    avatarUrl: null,
    memberCount: 1,
    isMember: false,
    canManage: false,
    cardJoinEnabled: true,
    joinApprovalRequired: true,
    admission: null,
  },
  applicantName: "U",
  inviterName: "V",
  isApplicant: true,
  ...patch,
});
it("viewing an invitation only exposes accept and decline to its recipient", () => {
  expect(groupAdmissionActions(detail())).toEqual(["accept", "decline"]);
  expect(groupAdmissionActions(detail({ isApplicant: false }))).toEqual([]);
});
it("a manager cannot approve an invitation that has not been accepted", () => {
  const value = detail({ isApplicant: false });
  value.group.canManage = true;
  expect(groupAdmissionActions(value)).toEqual([]);
  value.status = "PENDING";
  expect(groupAdmissionActions(value)).toEqual([]);
  value.acceptedAt = "2026-10-14";
  expect(groupAdmissionActions(value)).toEqual(["approve", "reject"]);
});
it.each(["JOINED", "DECLINED", "REJECTED", "EXPIRED"] as const)(
  "has no membership mutation for terminal %s",
  (status) => {
    expect(groupAdmissionActions(detail({ status }))).toEqual([]);
  },
);
it("unavailable groups expose no invitation action", () => {
  const value = detail();
  value.group.unavailable = true;
  expect(groupAdmissionActions(value)).toEqual([]);
});
