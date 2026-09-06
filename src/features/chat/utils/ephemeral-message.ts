import type { ChatMessage } from '@/types';

type EphemeralCheckInput = Pick<
  ChatMessage,
  'outgoing' | 'type' | 'burnDurationSec'
>;

/**
 * 这条消息是不是「别人在阅后即焚会话里发给我的」—— 也就是不该被永久化的那一类。
 *
 * 服务端对**转发**已经是这个判定（`CHAT_FORWARD_FORBIDDEN`，那段注释写得很清楚：
 * 短暂性是发送者对收件人的承诺，把它复制进一个没有 burn 的会话就是绕开承诺，
 * 副本还活得比源消息久）。端上不挡的话，用户点「转发」、挑好目标会话，才在最后
 * 一步吃一个错误 —— 与旁边 call-record 那个「永远不会成功的重试」是同一个毛病。
 *
 * 「收藏」走的是另一扇门：它把客户端拼出来的快照写进用户自己的收藏列表，服务端
 * 从头到尾没看过这条消息，所以那条转发规则根本管不到它。同一份承诺，同一道闸。
 *
 * 自己发的不拦，与服务端口径一致：那是你自己的内容，打开相册重发一次效果完全
 * 一样，拦下来不保护任何人，只是让你多走一步。
 *
 * 会话级开关之外还看消息自带的 `burnDurationSec`：推送冷启动时会话列表可能还没
 * 到，只读会话级的话会读成「没开焚毁」（image-bubble 里同一个理由）。
 */
export function isEphemeralPeerMessage(
  message: EphemeralCheckInput,
  conversationBurnEnabled: boolean,
): boolean {
  const ephemeral =
    (message.burnDurationSec ?? 0) > 0 || conversationBurnEnabled;
  if (!ephemeral) return false;
  // 'sent' 是纯文本的自己发；其余类型靠 outgoing 标记（与 ChatDetailScreen 里
  // 判断气泡归属的那一处同一条规则）。
  return !(message.outgoing || message.type === 'sent');
}
