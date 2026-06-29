// ---------------------------------------------------------------------------
// UI Types (used by screens and components)
// ---------------------------------------------------------------------------

export type ConversationType = 'group' | 'private';

export interface Conversation {
  id: string;
  sourceID: string;
  name: string;
  message: string;
  time: string;
  avatarUrl?: string;
  unreadCount: number;
  conversationType: ConversationType;
  pinned: boolean;
  muted: boolean;
}

/**
 * 用户自定义会话分组（label / bucket）。
 * 现在由 `/api/v1/conversation-groups` 后端持久化；conversationIDs 是 OpenIM 的
 * conversationID 列表（含私聊 + 群聊都行）。
 *
 * pinnedToTabs=true 时会出现在 MessagesScreen 顶部的筛选 tab 里。
 */
export interface CustomConversationGroup {
  id: string;
  name: string;
  sortOrder: number;
  pinnedToTabs: boolean;
  conversationIDs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface ContactSection {
  letter: string;
  data: Contact[];
}

export interface NoteCardData {
  noteId: string;
  ownerId?: string | null;
  title: string;
  contentPreview: string | null;
  coverUrl: string | null;
  imageCount: number;
  videoCount: number;
  groupNames: string[];
}

export interface FriendCardData {
  userID: string;
  nickname: string;
  faceURL: string;
  persona?: string | null;
  displayIcons?: DisplayIcon[];
}

export interface CircleCardData {
  circleId: string;
  name: string;
  avatarUrl: string | null;
}

export interface VerificationCardData {
  invitationId: string;
  circleName: string;
  applicantName: string;
}

export interface TransferCardData {
  amount: number;
  message: string | null;
}

export interface ChatMessage {
  id: string;
  type:
    | 'sent'
    | 'received'
    | 'date'
    | 'location'
    | 'image'
    | 'voice'
    | 'note-card'
    | 'friend-card'
    | 'circle-card'
    | 'transfer-card'
    | 'verification-card';
  text?: string;
  time?: string;
  senderName?: string;
  // 发送者用户 id（UUID 形式），仅接收消息携带；群聊点头像跳对方资料用。
  senderID?: string;
  locationTitle?: string;
  locationAddress?: string;
  // For image messages: source URL + optional intrinsic dimensions for layout
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  // For voice messages: local cache path or remote source URL plus duration in seconds.
  voiceUrl?: string;
  voicePath?: string;
  voiceDuration?: number;
  // Byte size of the voice clip; forwarded/re-sent remote voice needs it so the
  // OpenIM SDK renders size/progress instead of showing 0KB.
  voiceSize?: number;
  // For image / note-card / location messages: indicates direction (sent vs received)
  outgoing?: boolean;
  // For note-card messages: parsed payload
  noteCard?: NoteCardData;
  // For friend-card messages: parsed card payload
  friendCard?: FriendCardData;
  // For circle-card messages: parsed circle share payload
  circleCard?: CircleCardData;
  // For transfer-card messages: parsed payload
  transferCard?: TransferCardData;
  // For verification-card messages: parsed circle-verification invite payload
  verificationCard?: VerificationCardData;
  // OpenIM 发送状态：1=发送中, 2=已送达, 3=失败。仅自己发出的消息有意义。
  sendStatus?: 1 | 2 | 3;
  // 对方是否已读，由 onRecvC2CReadReceipt 维护。仅自己发出的消息有意义。
  isRead?: boolean;
}

export interface MenuItem {
  id: string;
  icon: string;
  label: string;
  iconBgColor?: string;
  subtitle?: string;
  rightText?: string;
  showArrow?: boolean;
  hasToggle?: boolean;
  destructive?: boolean;
}

export type DisplayIconType = 'SYSTEM' | 'CIRCLE';
export type SystemIconKey = 'VIP' | 'NEW_USER' | 'TOP_COLLABORATOR';

export interface DisplayIcon {
  id: string;
  type: DisplayIconType;
  title: string;
  imageUrl: string | null;
  fallbackIconName: string | null;
  circleId?: string;
  circleName?: string;
  systemKey?: SystemIconKey;
  likeCount?: number;
  sortOrder: number;
}

export interface IconOption {
  type: DisplayIconType;
  title: string;
  imageUrl: string | null;
  fallbackIconName: string | null;
  selected: boolean;
  circleId?: string;
  circleName?: string;
  systemKey?: SystemIconKey;
  likeCount?: number;
}

// ---------------------------------------------------------------------------
// API / Data Model Types
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  avatarFrameUrl: string | null;
  gender: 0 | 1 | 2;
  bio: string | null;
  city: string | null;
  creditScore: number;
  vipLevel: number;
}

export interface Circle {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  cover: string | null;
  ownerID: string;
  currentIconAssetID: string | null;
  currentIconUrl: string | null;
  cities: string[];
  isPublic: boolean;
  categories: string[];
  rules: string;
  tags: string[];
  joinVipRestriction: number | null;
  joinCreditRestriction: number | null;
  joinFancyRestriction: boolean;
  maxMembers: number;
  memberCanPost: boolean;
  groupID: string | null;
  memberCount: number;
  postCount: number;
  createdAt: string;
}

export interface ApiPost {
  id: string;
  circleId: string;
  authorId: string;
  content: string;
  media: MediaItem[];
  city: string | null;
  likeCount: number;
  commentCount: number;
  isPinned: boolean;
  createdAt: string;
}

export interface MediaItem {
  type: 'image' | 'video' | 'file';
  url: string;
  thumbUrl: string | null;
  size: number;
}

// ---------------------------------------------------------------------------
// Circle Plaza Types
// ---------------------------------------------------------------------------

export interface CirclePlazaPost {
  id: string;
  content: string;
  images: string[];
  tags: string[];
  city: string | null;
  isHorn: boolean;
  noteId: string | null;
  restrictions: {
    vipLevel: number | null;
    creditScore: number | null;
    fancyNumber: boolean;
  };
  viewCount: number;
  signupCount: number;
  signedByMe: boolean;
  signupRestrictions: {
    vipLevel: number | null;
    creditScore: number | null;
    fancyNumber: boolean;
  };
  canSignup: boolean;
  author: {
    id: string;
    nickname: string;
    avatarUrl: string | null;
    avatarFrame: string | null;
    accountId: string;
  };
  circle: {
    id: string;
    name: string;
  };
  canInteract: boolean;
  createdAt: string;
}

export interface CreatePlazaPostInput {
  content: string;
  images: string[];
  tags: string[];
  circleId: string;
  city: string | null;
  noteId: string | null;
  isHorn: boolean;
  vipRestriction: number | null;
  creditRestriction: number | null;
  fancyRestriction: boolean;
  signupVipRestriction: number | null;
  signupCreditRestriction: number | null;
  signupFancyRestriction: boolean;
}

export interface CircleDetail extends Circle {
  myRole: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
  myStatus: 'ACTIVE' | 'PENDING' | 'REJECTED' | null;
  availableIconAssets?: {
    id: string;
    name: string;
    imageUrl: string | null;
  }[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface CreateCircleInput {
  name: string;
  categories: string[];
  description: string;
  avatarUrl?: string;
  cities?: string[];
  rules?: string;
  tags?: string[];
  joinVipRestriction?: number | null;
  joinCreditRestriction?: number | null;
  joinFancyRestriction?: boolean;
  maxMembers?: number;
  memberCanPost?: boolean;
}

// ---------------------------------------------------------------------------
// Circle Invitation / Verification Types
// ---------------------------------------------------------------------------

export interface CircleInvitation {
  id: string;
  circleId: string;
  circleName: string;
  applicant: { id: string; nickname: string; avatarUrl: string | null; accountId: string };
  inviter: { id: string; nickname: string; avatarUrl: string | null; accountId: string };
  requiredCount: number;
  approvedCount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ADMIN_APPROVED';
  verifiers: CircleInvitationVerifier[];
  createdAt: string;
}

export interface CircleInvitationVerifier {
  id: string;
  verifier: { id: string; nickname: string; avatarUrl: string | null; accountId: string };
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  respondedAt: string | null;
}

// ---------------------------------------------------------------------------
// Friend Moments (朋友圈) Types
// ---------------------------------------------------------------------------

export interface MomentPost {
  id: string;
  content: string;
  images: string[];
  visibility: 'PUBLIC' | 'FRIENDS_ONLY' | 'PRIVATE';
  author: { id: string; nickname: string; avatarUrl: string | null };
  likeCount: number;
  commentCount: number;
  isLikedByMe: boolean;
  likedFriends: { id: string; nickname: string }[];
  comments: MomentComment[];
  createdAt: string;
}

export interface MomentComment {
  id: string;
  content: string;
  user: { id: string; nickname: string };
  replyTo: { id: string; nickname: string } | null;
  createdAt: string;
}

export interface CreateMomentInput {
  content: string;
  images: string[];
  visibility: 'FRIENDS_ONLY' | 'PRIVATE';
}

// ---------------------------------------------------------------------------
// Notification Center (互动消息) Types
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'SYSTEM'
  | 'TRACE_LIKE'
  | 'TRACE_COMMENT'
  | 'COMMENT_REPLY'
  | 'FRIEND_REQUEST_RECEIVED'
  | 'FRIEND_REQUEST_ACCEPTED'
  | 'FRIEND_REQUEST_REJECTED'
  | 'CIRCLE_VERIFICATION_REQUESTED'
  | 'CIRCLE_INVITATION_APPROVED'
  | 'CIRCLE_INVITATION_REJECTED'
  | 'CIRCLE_ADMIN_OVERRIDE_APPROVED'
  | 'CIRCLE_POST_SIGNUP_CREATED';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  content: string;
  read: boolean;
  createdAt: string;
  fromUser: { id: string; nickname: string; avatarUrl: string | null } | null;
  fromTrace: { id: string; excerpt: string; firstImage: string | null } | null;
  fromReply: { id: string; content: string } | null;
  fromCircle: { id: string; name: string } | null;
  fromCirclePost: {
    id: string;
    excerpt: string;
    firstImage: string | null;
  } | null;
  fromInvitation: { id: string; status: string } | null;
}

/** A circle post authored by the current user, for the signup-management list. */
export interface MyCirclePost {
  id: string;
  circleId: string;
  excerpt: string;
  firstImage: string | null;
  signupCount: number;
  unreadSignupCount: number;
  status: string;
  createdAt: string;
}

/** A person who signed up for one of my posts, with identity to open a chat. */
export interface PostSignupItem {
  userId: string;
  imUserId: string;
  nickname: string;
  avatarUrl: string | null;
  accountId: string;
  signedAt: string;
  seen: boolean;
}
