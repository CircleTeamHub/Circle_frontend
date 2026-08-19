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

const CHAT_SEND = 'chat:send';
const CHAT_MESSAGE = 'chat:msg';

function deliveryTimestamp(message, prefix) {
  const text = message?.content?.text;
  if (typeof text !== 'string' || !text.startsWith(prefix)) return null;
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

export function runChatSession({ config, account, messages, keepOpenMs = 1000 }) {
  const pending = new Map();
  let nextAckId = 1;
  let nextMessage = 0;
  let connected = false;
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
        const sentAt = deliveryTimestamp(packet.args[0], prefix);
        if (sentAt !== null) {
          chatDeliveryMs.add(Math.max(0, Date.now() - sentAt));
          chatDelivered.add(1);
        }
      }
    });

    socket.on('error', () => chatSendFailed.add(true, { reason: 'socket' }));
    socket.setInterval(() => {
      if (!connected || nextMessage >= messages.length) return;
      for (let sentInBatch = 0; sentInBatch < batchSize; sentInBatch += 1) {
        if (nextMessage >= messages.length) break;
        const ackId = nextAckId++;
        const messageIndex = nextMessage;
        const source = messages[nextMessage++];
        const sentAt = Date.now();
        const payload = {
          ...source,
          content: {
            ...source.content,
            text: `${prefix}-${sentAt}-${__VU}-${messageIndex}`,
          },
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
    keepOpenMs: 1000,
  });
}
