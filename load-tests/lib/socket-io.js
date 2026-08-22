function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Malformed Socket.IO ${label}.`);
  }
}

function requireToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Socket.IO access token is required.');
  }
}

export function encodeConnect(token) {
  requireToken(token);
  return `40${JSON.stringify({ token })}`;
}

export function encodeEvent(event, payload, ackId) {
  if (typeof event !== 'string' || event.length === 0) {
    throw new Error('Socket.IO event name is required.');
  }
  if (ackId !== undefined && (!Number.isSafeInteger(ackId) || ackId < 0)) {
    throw new Error('Socket.IO ack id must be a non-negative integer.');
  }
  return `42${ackId ?? ''}${JSON.stringify([event, payload])}`;
}

export function encodePong() {
  return '3';
}

function splitIdAndJson(raw, label, requireId = false) {
  const match = raw.match(/^(\d*)([\[{].*)$/s);
  if (!match) throw new Error(`Malformed Socket.IO ${label}.`);
  const id = match[1] ? Number(match[1]) : undefined;
  if (requireId && id === undefined) {
    throw new Error(`Malformed Socket.IO ${label}: missing ack id.`);
  }
  return { id, value: parseJson(match[2], label) };
}

export function parsePacket(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Malformed Socket.IO packet.');
  }
  if (raw === '2') return { kind: 'ping' };
  if (raw === '3') return { kind: 'pong' };
  if (raw.startsWith('0')) {
    return { kind: 'engine-open', data: parseJson(raw.slice(1), 'open packet') };
  }
  if (raw.startsWith('40')) {
    const suffix = raw.slice(2);
    return {
      kind: 'connected',
      data: suffix ? parseJson(suffix, 'connect packet') : {},
    };
  }
  if (raw.startsWith('41')) return { kind: 'disconnected' };
  if (raw.startsWith('42')) {
    const { value } = splitIdAndJson(raw.slice(2), 'event');
    if (!Array.isArray(value) || typeof value[0] !== 'string') {
      throw new Error('Malformed Socket.IO event.');
    }
    return { kind: 'event', event: value[0], args: value.slice(1) };
  }
  if (raw.startsWith('43')) {
    const { id, value } = splitIdAndJson(raw.slice(2), 'ack', true);
    if (!Array.isArray(value)) throw new Error('Malformed Socket.IO ack.');
    return { kind: 'ack', id, args: value };
  }
  if (raw.startsWith('44')) {
    return { kind: 'connect-error', data: parseJson(raw.slice(2), 'connect error') };
  }
  return { kind: 'unknown', raw };
}
