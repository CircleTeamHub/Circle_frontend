import type {
  GroupAdmissionDetail,
  GroupAdmissionAction,
} from "@/services/api/group-admissions";
/** Viewing a record never accepts it. Only these explicit actions may mutate membership. */
export function groupAdmissionActions(
  detail: GroupAdmissionDetail,
): GroupAdmissionAction[] {
  if (detail.group.unavailable) return [];
  if (
    detail.isApplicant &&
    detail.kind === "INVITE" &&
    detail.status === "INVITED"
  )
    return ["accept", "decline"];
  if (
    detail.group.canManage &&
    detail.status === "PENDING" &&
    detail.acceptedAt
  )
    return ["approve", "reject"];
  return [];
}
