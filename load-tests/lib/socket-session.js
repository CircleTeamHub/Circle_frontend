import { check } from 'k6';
import ws from 'k6/ws';
import {
  chatAckMs,
  chatDelivered,
  chatDeliveryMs,
  chatSendFailed,
  chatSent,
} from './metrics.js';
import { encodeConnect, encodeEvent, encodePong, parsePacket } from './socket-io.js';
import { DEFAULT_ACK_P95_MS } from './thresholds.js';

const CHAT_SEND = 'chat:send';
const CHAT_MESSAGE = 'chat:msg';

/**
 * 只把「别人发来的」本次压测消息算作一次投递。
 *
 * chat:msg 会广播给会话全体成员，**包括发送者自己**。把回声也计进
 * chat_delivery_ms 会让一个带阈值门禁的指标去测环回：chat-send 没有独立接收
 * 方，全部样本都是回声，那条阈值从没测过扇出；chat-fan-in 里发送方远多于接收
 * 方，p95 会被发送方的环回主导，而不是被接收方的真实体验决定。
 *
 * 判据用「这段文本是不是我自己发出去的」——本地精确，不依赖服务端字段，也
 * 不依赖 __VU 在多 scenario 下的编号假设。
 */
function deliveryTimestamp(message, prefix, sentTexts) {
  const text = message?.content?.text;
  if (typeof text !== 'string' || !text.startsWith(prefix)) return null;
  if (sentTexts.has(text)) return null;
  const suffix = text.slice(prefix.length);
  const match = suffix.match(/^-(\d{13})-/);
  return match ? Number(match[1]) : null;
}

export function buildTextMessage(config, conversationId, sequence) {
  const prefix = `WINDNOTE-LOAD-${config.runId}`;
  const deliveryId = `load-${config.runId}-${__VU}-${__ITER}-${sequence}-${Date.now()}`;
  return {
    conversationId,
    type: 'text',
    content: { text: `${prefix}-pending-${__VU}-${sequence}` },
    d: deliveryId,
  };
}

/**
 * 收尾宽限期必须覆盖 ack 预算本身。发送循环跑满 durationSeconds，只留 1s 就
 * 关闭的话，最后一批 ack 还没回来就被记成 timeout —— 而 chat_ack_ms 允许到
 * p(95)<1500ms。那样 chat_send_failed 有一部分测的是本 harness 的关闭时机：
 * 服务端越接近（但仍在）预算上限，失败率反而越难看。取 2 倍留出尾部余量。
 */
export const DEFAULT_DRAIN_MS = DEFAULT_ACK_P95_MS * 2;

export function runChatSession({
  config,
  account,
  messages,
  keepOpenMs = DEFAULT_DRAIN_MS,
}) {
  const pending = new Map();
  const sentTexts = new Set();
  let nextAckId = 1;
  let nextMessage = 0;
  let connected = false;
  let rejected = false;
  const prefix = `WINDNOTE-LOAD-${config.runId}`;
  const intervalMs = Math.max(
    25,
    Math.floor((config.durationSeconds * 1000) / Math.max(messages.length, 1)),
  );
  const availableTicks = Math.max(
    1,
    Math.floor((config.durationSeconds * 1000) / intervalMs),
  );
  const batchSize = Math.max(1, Math.ceil(messages.length / availableTicks));

  const response = ws.connect(config.socketUrl, { tags: { account: account.alias } }, (socket) => {
    socket.on('message', (raw) => {
      let packet;
      try {
        packet = parsePacket(String(raw));
      } catch {
        chatSendFailed.add(true, { reason: 'protocol' });
        return;
      }
      if (packet.kind === 'engine-open') {
        socket.send(encodeConnect(account.accessToken));
        return;
      }
      if (packet.kind === 'ping') {
        socket.send(encodePong());
        return;
      }
      if (packet.kind === 'connected') {
        connected = true;
        return;
      }
      // 这两个包过去解出来就丢掉了。最常见的操作失误是 accounts 文件里的 token
      // 过期：WS 升级照样 101、'websocket upgraded' 那条 check 照样过，然后
      // connected 永远是 false，收尾时每条消息记成 'unsent' —— 唯一带着真实原因
      // 的那个包被扔了，报告指向节流而不是凭据。
      if (packet.kind === 'connect-error') {
        rejected = true;
        chatSendFailed.add(true, {
          reason: `connect-error:${packet.data?.message ?? packet.data?.code ?? 'unknown'}`,
        });
        socket.close();
        return;
      }
      if (packet.kind === 'disconnected') {
        connected = false;
        rejected = true;
        chatSendFailed.add(true, { reason: 'server-disconnect' });
        socket.close();
        return;
      }
      if (packet.kind === 'ack') {
        const startedAt = pending.get(packet.id);
        if (startedAt === undefined) return;
        pending.delete(packet.id);
        const ack = packet.args[0];
        const ok = ack?.ok === true;
        chatSendFailed.add(!ok, { reason: ok ? 'none' : String(ack?.code ?? 'rejected') });
        if (ok) chatAckMs.add(Date.now() - startedAt);
        return;
      }
      if (packet.kind === 'event' && packet.event === CHAT_MESSAGE) {
        const sentAt = deliveryTimestamp(packet.args[0], prefix, sentTexts);
        if (sentAt !== null) {
          chatDeliveryMs.add(Math.max(0, Date.now() - sentAt));
          chatDelivered.add(1);
        }
      }
    });

    socket.on('error', () => chatSendFailed.add(true, { reason: 'socket' }));
    socket.setInterval(() => {
      if (rejected || !connected || nextMessage >= messages.length) return;
      for (let sentInBatch = 0; sentInBatch < batchSize; sentInBatch += 1) {
        if (nextMessage >= messages.length) break;
        const ackId = nextAckId++;
        const messageIndex = nextMessage;
        const source = messages[nextMessage++];
        const sentAt = Date.now();
        const text = `${prefix}-${sentAt}-${__VU}-${messageIndex}`;
        sentTexts.add(text);
        const payload = {
          ...source,
          content: { ...source.content, text },
        };
        pending.set(ackId, sentAt);
        chatSent.add(1);
        socket.send(encodeEvent(CHAT_SEND, payload, ackId));
      }
    }, intervalMs);
    socket.setTimeout(() => {
      for (const _ of pending.values()) chatSendFailed.add(true, { reason: 'timeout' });
      while (nextMessage < messages.length) {
        chatSendFailed.add(true, { reason: 'unsent' });
        nextMessage += 1;
      }
      socket.close();
    }, config.durationSeconds * 1000 + keepOpenMs);
  });

  check(response, { 'Socket.IO websocket upgraded': (result) => result?.status === 101 });
}

export function runReceiveSession({ config, account, durationSeconds }) {
  runChatSession({
    config: { ...config, durationSeconds },
    account,
    messages: [],
  });
}
