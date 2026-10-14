import { GroupAdmissionsList } from '@/features/groups/GroupAdmissionsList';
/** Pending invitations/applications and results, followed by joined groups. */
export function NewGroupsInboxList({ query }: { query: string }) {
  return <GroupAdmissionsList query={query} includeJoined />;
}
