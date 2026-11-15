import { GroupAdmissionsList } from '@/features/groups/GroupAdmissionsList';
import type { NewFriendsScope } from '@/features/user/utils/routes';

/** Pending invitations/applications and results, followed by joined groups. */
export function NewGroupsInboxList({ query, scope }: { query: string; scope: NewFriendsScope }) {
  // 群行点进去(入群详情、群聊)跟着「新的朋友」所在的栈走,不跨 tab。
  return <GroupAdmissionsList query={query} includeJoined scope={scope} />;
}
