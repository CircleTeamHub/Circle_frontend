/**
 * 聊天长连接连不上时要不要提示用户、提示哪一种。
 *
 * 只看「上一次握手失败了,而且还没被一次成功抵消」:store.error 只在 connect_error
 * 时写入、只在 connect 成功时清掉。不看 connecting —— 回前台时 connectChat 会把它
 * 置回 true,拿它压住提示的话,服务器整个没了也要每次再等一个握手超时(20 秒)
 * 才露面,用户只看到缓存里的会话和一直「发送中」的消息,以为一切正常。
 * 首次建连还没失败过时 error 为空,所以正常启动和短暂断线重连都保持安静。
 */
export type ChatConnectionNotice = 'unreachable' | 'server_error';

interface ChatConnectionSnapshot {
  currentUserId: string | null;
  connected: boolean;
  error: string | null;
}

// 传输层失败:请求根本没到服务器(超时、连接被拒、DNS 解析不了)。
const UNREACHABLE_REASONS = new Set(['timeout', 'transport_error', 'network_error']);
// 鉴权失败由 token 刷新或登出接管,不是连接故障。
const AUTH_REASONS = new Set(['unauthorized', 'forbidden']);

export function getChatConnectionNotice(
  state: ChatConnectionSnapshot,
): ChatConnectionNotice | null {
  if (!state.currentUserId || state.connected || !state.error) return null;
  if (AUTH_REASONS.has(state.error)) return null;
  return UNREACHABLE_REASONS.has(state.error) ? 'unreachable' : 'server_error';
}
