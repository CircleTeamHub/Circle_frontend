// ---------------------------------------------------------------------------
// UI Types (used by screens and components)
// ---------------------------------------------------------------------------

export type ConversationType = 'group' | 'private';

export interface Conversation {
  id: string;
  name: string;
  message: string;
  time: string;
  avatarUrl?: string;
  unreadCount: number;
  conversationType: ConversationType;
  customGroupIds?: string[];
}

export interface CustomConversationGroup {
  id: string;
  name: string;
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

export interface Post {
  id: string;
  author: string;
  badge: string;
  time: string;
  content: string;
  imageUrl?: string;
  likes: number;
  comments: number;
}

export interface ChatMessage {
  id: string;
  type: 'sent' | 'received' | 'date' | 'location';
  text?: string;
  time?: string;
  locationTitle?: string;
  locationAddress?: string;
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
  ownerId: string;
  cities: string[];
  isPublic: boolean;
  memberCount: number;
  postCount: number;
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
