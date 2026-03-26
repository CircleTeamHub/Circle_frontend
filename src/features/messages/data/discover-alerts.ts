export interface DiscoverAlertItem {
  id: string;
  title: string;
  time: string;
  unread: boolean;
}

export const DISCOVER_ALERTS: DiscoverAlertItem[] = [
  { id: '1', title: '圈子广场有 3 条新动态', time: '刚刚', unread: true },
  { id: '2', title: '生活圈发布了新的热门内容', time: '12分钟前', unread: true },
  { id: '3', title: '美食圈新增了一条精选帖子', time: '1小时前', unread: true },
  { id: '4', title: '同城圈有人提到了你关注的话题', time: '昨天', unread: true },
  { id: '5', title: '圈子广场推荐了新的内容', time: '昨天', unread: true },
];

export function getUnreadDiscoverAlertCount() {
  return DISCOVER_ALERTS.filter((item) => item.unread).length;
}
