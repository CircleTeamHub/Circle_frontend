export { default as ChatDetailScreen } from './screens/ChatDetailScreen';
export { default as ChatInfoScreen } from './screens/ChatInfoScreen';
// 之前漏掉 4 个新加的卡片气泡 + status 文本；现有路由都直接从 chat-bubble 导入，
// barrel 不修也不会断，但暴露的接口应当与实际定义一致，方便外部按 feature 引用。
export {
  DatePill,
  ReceivedBubble,
  SentBubble,
  LocationCard,
  ImageBubble,
  NoteCardBubble,
  FriendCardBubble,
  TransferCardBubble,
  BubbleStatusText,
} from './components/chat-bubble';
