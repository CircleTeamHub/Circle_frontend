import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { decrementUnreadBadgesFor } from './unread-badges';

beforeEach(() => {
  useTabBadgeStore.getState().reset();
  useTabBadgeStore.setState({
    discoverUnread: 5, momentsUnread: 2, circleUnread: 3, groupNoticeUnread: 1, profileUnread: 1,
  });
});

const counts = () => {
  const { discoverUnread, momentsUnread, circleUnread, groupNoticeUnread, profileUnread } = useTabBadgeStore.getState();
  return { discoverUnread, momentsUnread, circleUnread, groupNoticeUnread, profileUnread };
};

test.each([
  ['TRACE_LIKE', { discoverUnread: 4, momentsUnread: 1 }],
  ['CIRCLE_MEMBER_REMOVED', { discoverUnread: 4, circleUnread: 2 }],
  ['CIRCLE_INVITATION_RECEIVED', { discoverUnread: 4, circleUnread: 2 }],
  // 群聊知会与公告不在两个铃铛的合计口径里：discoverUnread 不动。
  ['GROUP_MEMBER_REMOVED', { groupNoticeUnread: 0 }],
  ['SYSTEM', { profileUnread: 0 }],
  // 入群申请有自己的计数（「新的朋友」），这里一个都不扣。
  ['GROUP_ADMISSION', {}],
])('reading one %s only takes it off its own entry', (type, changed) => {
  const before = counts();
  decrementUnreadBadgesFor(type);
  expect(counts()).toEqual({ ...before, ...changed });
});

test('never goes below zero', () => {
  useTabBadgeStore.setState({ groupNoticeUnread: 0 });
  decrementUnreadBadgesFor('GROUP_DISSOLVED');
  expect(useTabBadgeStore.getState().groupNoticeUnread).toBe(0);
});
