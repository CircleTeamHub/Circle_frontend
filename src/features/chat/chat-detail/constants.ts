import { Ionicons } from '@expo/vector-icons';
import { LayoutAnimation, Platform, UIManager } from 'react-native';

/**
 * 聊天详情页(ChatDetailScreen)的常量。拆分自原 4700 行的页面文件,内容未改。
 */

export type AttachmentId =
  | 'media'
  | 'voice-call'
  | 'location'
  | 'notes'
  | 'friend-card'
  | 'favorites'
  | 'quick-reply'
  | 'transfer';

export const ATTACHMENT_ITEMS: readonly {
  id: AttachmentId;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
  label: string;
}[] = [
  { id: 'media', icon: 'images-outline', labelKey: 'chat.attachments.mediaHub', label: '自媒体' },
  { id: 'voice-call', icon: 'call-outline', labelKey: 'chat.attachments.voiceCall', label: '语/视频通话' },
  { id: 'location', icon: 'location-outline', labelKey: 'chat.attachments.location', label: '位置' },
  { id: 'notes', icon: 'create-outline', labelKey: 'chat.attachments.notes', label: '笔记' },
  { id: 'friend-card', icon: 'person-outline', labelKey: 'chat.attachments.friendCard', label: '好友名片' },
  { id: 'favorites', icon: 'star-outline', labelKey: 'chat.attachments.favorites', label: '我的收藏' },
  { id: 'transfer', icon: 'card-outline', labelKey: 'chat.attachments.transfer', label: '转账' },
  { id: 'quick-reply', icon: 'rocket-outline', labelKey: 'chat.attachments.quickReply', label: '快捷语' },
];

// 工具面板每页最多 8 个（4 列 × 2 行），超出的横向翻页
export const ATTACHMENT_PAGE_SIZE = 8;
export const MENTION_CANDIDATE_LIMIT = 200;
// scrollToIndex 定位失败后最多重试几次（每次间隔 250ms）。够覆盖「再渲染一两批就能
// 测到目标行」的正常情况，又不至于在测不到时无限跳动。
export const MAX_SCROLL_TO_INDEX_RETRIES = 4;
// inverted 列表中 contentOffset.y=0 就是最新消息。用户仍在这个范围内时，
// 收到新消息可以自然跟随；超出后视为正在翻历史，不抢走阅读位置。
export const LATEST_MESSAGE_SCROLL_THRESHOLD = 80;
export const VIDEO_UPLOAD_TIMEOUT_MS = 5 * 60_000;

export const ATTACHMENT_PAGES: (typeof ATTACHMENT_ITEMS)[number][][] = Array.from(
  { length: Math.ceil(ATTACHMENT_ITEMS.length / ATTACHMENT_PAGE_SIZE) },
  (_, page) =>
    ATTACHMENT_ITEMS.slice(
      page * ATTACHMENT_PAGE_SIZE,
      page * ATTACHMENT_PAGE_SIZE + ATTACHMENT_PAGE_SIZE,
    ),
);

// Android 需显式开启 LayoutAnimation（iOS 默认可用）。
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// 底部面板展开/收起的协调布局过渡：面板高度变化与消息区缩放一起平滑动，
// 输入栏位置由 flex 决定、始终在面板上方，不会割裂。稍慢一点更顺眼。
export const PANEL_LAYOUT_ANIM = {
  duration: 300,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};

/** 引用跳转最多往回翻几页(一页 50 条);翻不到就放弃,不能无界翻。 */
export const QUOTE_PAGING_MAX = 10;

/** 定位高亮的停留时长:够看清"跳到了哪条",又不会赖着不走。 */
export const HIGHLIGHT_VISIBLE_MS = 3000;
