import type { ChatGroupPoliciesDto } from '@/chat-core/protocol';
import {
  type GroupRole,
  isGroupManager,
} from '@/features/chat/group-admin-permissions';

/**
 * 群策略开关对「本人」是否放行 —— 三张屏(群信息 / 聊天页 / 成员搜索)共用的
 * 唯一判据,别再各自手写。
 *
 * 规则与服务端一致:群主/管理员一律豁免;普通成员按开关。策略缺省
 * (老后端不下发 policies)按放开处理 —— 这些开关都是收紧型的,缺省收紧会把
 * 老后端上的每个普通成员全部锁死。
 *
 * 「成员可查看他人资料」只在客户端拦(资料接口没有群上下文),所以哪一处漏
 * 用这个判据,那一处就是绕过 —— 成员搜索页曾对圈子群直接放行就是这么来的。
 */
export interface GroupPolicyActor {
  /** 本人在该群的角色;null/缺省 = 普通成员或未知。 */
  role?: GroupRole | null;
  /** 群策略开关;null/缺省 = 老后端,按放开处理。 */
  policies?: ChatGroupPoliciesDto | null;
}

export function groupPolicyAllows(
  key: keyof ChatGroupPoliciesDto,
  actor: GroupPolicyActor,
): boolean {
  if (isGroupManager(actor.role)) return true;
  return actor.policies?.[key] ?? true;
}

/** 普通成员能否从群里打开其他成员的资料(看自己的资料永远放行,调用方自判)。 */
export function allowsMemberProfiles(actor: GroupPolicyActor): boolean {
  return groupPolicyAllows('membersCanViewProfiles', actor);
}

/** 普通成员能否拉人进群(独立群聊的「+」邀请块与服务端 CHAT_GROUP_INVITE_DISABLED 同判据)。 */
export function allowsMemberInvites(actor: GroupPolicyActor): boolean {
  return groupPolicyAllows('memberCanInvite', actor);
}
