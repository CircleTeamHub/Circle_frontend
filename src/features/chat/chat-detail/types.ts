/** 会话形态判别(旧 OpenIM SessionType 枚举的最小替代)。 */
export type ConversationKind = 'single' | 'group';

/**
 * 上传管线用得到的媒体字段。首发传 ImagePicker 的 asset;App 重启后重发传持久副本
 * (见 reuploadPendingMedia),那时只剩 outbox 里记下的这几项。
 */
export interface ChatMediaFile {
  uri: string;
  width?: number | null;
  height?: number | null;
  /** 毫秒(与 ImagePicker 一致)。 */
  duration?: number | null;
  fileSize?: number | null;
}

/** 聊天详情页的入口参数(路由 query 或桌面分栏内嵌时直接传入)。 */
export type ChatDetailRouteParams = {
  conversationID?: string;
  sourceID?: string;
  title?: string;
  conversationType?: 'private' | 'group';
  conversationKind?: 'direct' | 'group' | 'temp' | 'support';
  avatarUrl?: string;
  searchedMsgID?: string;
};

// type 而非 interface：路由跳转处要把它原样塞给 router.push 的 params，
// 只有 type 字面量带隐式索引签名、能赋给 expo-router 的 UnknownInputParams。
export type EmbeddedChatParams = {
  conversationID: string;
  sourceID?: string;
  title?: string;
  conversationType?: 'private' | 'group';
  conversationKind?: 'direct' | 'group' | 'temp' | 'support';
  avatarUrl?: string;
  searchedMsgID?: string;
};
