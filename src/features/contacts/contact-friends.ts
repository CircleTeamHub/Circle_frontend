import type { FriendProfile, FriendTag } from '@/services/api/friends';

export type ContactFriendSection = {
  title: string;
  data: FriendProfile[];
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * 通讯录里这位好友该显示的名字：备注 > 昵称 > 账号。
 *
 * 备注优先是「设了备注就该看见备注」的直觉（微信同款），也是加好友时
 * 填的备注真正生效的地方 —— 后端在 accept 时把申请里的备注提升成
 * remarkA，这里必须读它，否则用户会觉得那次填写石沉大海。
 * 排序与字母分组都基于本函数，因此备注同样决定好友落在哪个字母段。
 */
export function getFriendDisplayName(
  friend: Pick<FriendProfile, 'nickname' | 'accountId' | 'remark'>,
) {
  const remark = friend.remark?.trim();
  if (remark) return remark;
  const nickname = friend.nickname?.trim();
  return nickname || friend.accountId;
}

function getAlphaInitial(value: string) {
  const initial = value.trim().charAt(0).toUpperCase();
  return LETTERS.includes(initial) ? initial : null;
}

export function getFriendSortKey(
  friend: Pick<FriendProfile, 'nickname' | 'accountId' | 'remark'>,
) {
  const displayName = getFriendDisplayName(friend);
  return getAlphaInitial(displayName) ? displayName : friend.accountId;
}

export function getFriendSectionTitle(
  friend: Pick<FriendProfile, 'nickname' | 'accountId' | 'remark'>,
) {
  return getAlphaInitial(getFriendSortKey(friend)) ?? '#';
}

function compareFriends(left: FriendProfile, right: FriendProfile) {
  return getFriendSortKey(left)
    .localeCompare(getFriendSortKey(right), 'en', { sensitivity: 'base' });
}

export function buildRecentFriends(friends: FriendProfile[]) {
  return [...friends].sort(
    (left, right) =>
      new Date(right.friendsSince).getTime() - new Date(left.friendsSince).getTime(),
  );
}

/**
 * 按 id 去重(保留首次出现)。后端 `/friend` 偶发返回重复好友行(同一 id 多次),不去重会让
 * SectionList 出现两个同 key 子节点(React 报 "two children with the same key" 并可能重复/漏渲染)。
 * 不信任外部数据,在组装列表层兜底 —— 真正的重复行仍需后端排查。
 */
export function dedupeFriendsById(friends: FriendProfile[]): FriendProfile[] {
  const seen = new Set<string>();
  return friends.filter((friend) => {
    if (seen.has(friend.id)) {
      return false;
    }
    seen.add(friend.id);
    return true;
  });
}

export function buildContactSections(friends: FriendProfile[]): ContactFriendSection[] {
  const grouped = new Map<string, FriendProfile[]>();

  for (const friend of dedupeFriendsById(friends).sort(compareFriends)) {
    const title = getFriendSectionTitle(friend);
    const bucket = grouped.get(title);

    if (bucket) {
      bucket.push(friend);
      continue;
    }

    grouped.set(title, [friend]);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => {
      if (left === '#') {
        return 1;
      }

      if (right === '#') {
        return -1;
      }

      return left.localeCompare(right, 'en', { sensitivity: 'base' });
    })
    .map(([title, data]) => ({ title, data }));
}

export function sortFriendTags(tags: FriendTag[]) {
  return [...tags].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' }),
  );
}
