type Purge = { conversationId?: string; clientMessageId?: string; serverMessageId?: string; expired?: boolean };
const listeners = new Set<(value: Purge) => void>();
export function onEncryptedBodyPurge(listener: (value: Purge) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function purgeEncryptedBody(value: Purge) { for (const listener of listeners) listener(value); }
