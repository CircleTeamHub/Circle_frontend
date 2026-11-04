import type { ChatMessageDto } from '@/chat-core/protocol';
import type { UserCollection } from '@/services/api/collections';
import { getCollectionForwardItem, resolveCollectionContent } from './collection-content';

jest.mock('@/services/api/client', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/dev-log', () => ({ devWarn: jest.fn() }));
jest.mock('@/constants/config', () => ({
  API_URL: 'https://api.example.com/api/v1',
  MEDIA_ORIGINS: ['https://cdn.example.com'],
}));
jest.mock('@/i18n', () => ({ __esModule: true, default: {
  language: 'en', t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
} }));

const source = (overrides: Partial<ChatMessageDto> = {}): ChatMessageDto => ({
  id: 'original-message', conversationId: 'original-conversation', height: 42, type: 'image',
  content: { key: 'chat/peer/photo', url: 'https://cdn.example.com/photo?signature=fresh', width: 320, height: 240 },
  sender: { id: 'peer', nickname: 'Peer', avatarUrl: null },
  replyToId: null, d: null, createdAt: '2026-11-01T00:00:00Z', ...overrides,
});
const item = (overrides: Partial<UserCollection> = {}): UserCollection => ({
  id: 'collection', userID: 'me', type: 'MESSAGE', title: '图片消息', summary: '图片',
  sourceID: 'original-message', payload: {}, createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
  ...overrides,
});
const legacy = (messageType: string, content: Record<string, unknown> = {}) => ({
  kind: 'openim-message', messageID: 'legacy-message', conversationID: 'legacy-conversation',
  messageType, senderID: 'peer', senderName: 'Peer', time: '10:30', ...content,
});

test.each(['source', 'legacy'])('preserves a saved transfer receipt from its %s without making it forwardable', (origin) => {
  const receipt = { amount: 125, message: 'Lunch' };
  const collection = item({ title: '积分转账', summary: '125 Credits',
    payload: legacy('transfer-card', { transferCard: receipt }),
    ...(origin === 'source' ? { message: source({ type: 'transfer-card', content: receipt }) } : {}),
  });
  expect(resolveCollectionContent(collection, 'me')).toMatchObject({
    kind: 'transfer-card', text: '125 Credits', message: { transferCard: receipt },
  });
  expect(getCollectionForwardItem(collection, 'me')).toBeNull();
});

test('resolves an old image through the authoritative message even when the payload has no media', () => {
  const collection = item({ message: source(), payload: legacy('image') });
  expect(resolveCollectionContent(collection, 'me')).toMatchObject({
    kind: 'image', imageUri: 'https://cdn.example.com/photo?signature=fresh', width: 320, height: 240,
    message: { id: 'original-message', type: 'image', outgoing: false, senderID: 'peer' },
  });
  expect(getCollectionForwardItem(collection, 'me')?.dto).toMatchObject({
    id: 'original-message', conversationId: 'original-conversation', height: 42,
  });
});

test('resolves a previously empty video snapshot using fresh source media and poster', () => {
  const collection = item({ type: 'VIDEO', message: source({ type: 'video', content: {
    key: 'chat/peer/video', url: 'https://cdn.example.com/video?signature=fresh',
    thumbUrl: 'https://cdn.example.com/poster?signature=fresh', duration: 8, width: 1920, height: 1080,
  } }) });
  expect(resolveCollectionContent(collection, 'me')).toMatchObject({
    kind: 'video', videoUri: 'https://cdn.example.com/video?signature=fresh',
    posterUri: 'https://cdn.example.com/poster?signature=fresh', duration: 8, width: 1920, height: 1080,
  });
  expect(getCollectionForwardItem(collection, 'me')?.dto?.height).toBe(42);
});

test('never loads external media or a local path from a server source', () => {
  const result = resolveCollectionContent(item({ message: source({ content: {
    key: 'chat/peer/photo', url: 'https://tracker.example.com/photo',
    thumbUrl: 'https://tracker.example.com/thumb', localUri: 'file:///private/photo.jpg',
  } }) }), 'me');
  expect(result.imageUri).toBeUndefined();
  expect(result.posterUri).toBeUndefined();
  expect(result.message?.imageUrl).toBeUndefined();
});

test('authoritative unavailable sources cannot revive legacy media URLs or forwarding', () => {
  const collection = item({ message: null, payload: legacy('image', { image: { url: 'https://cdn.example.com/expired' } }) });
  expect(resolveCollectionContent(collection, 'me')).toMatchObject({ kind: 'image', message: null });
  expect(resolveCollectionContent(collection, 'me').imageUri).toBeUndefined();
  expect(getCollectionForwardItem(collection, 'me')).toBeNull();
});

test('uses the full legacy payload text once and keeps mapping independent of the viewing account', () => {
  const collection = item({ title: 'truncated', summary: 'truncated', payload: legacy('received', { text: 'the full original message' }) });
  expect(resolveCollectionContent(collection, 'me')).toMatchObject({
    kind: 'text', text: 'the full original message', message: { type: 'received', senderID: 'peer', outgoing: false },
  });
  expect(resolveCollectionContent(collection, 'peer').message).toMatchObject({ type: 'sent', outgoing: true });
  expect(getCollectionForwardItem(collection, 'me')?.message.text).toBe('the full original message');
  expect(resolveCollectionContent(collection, 'me').message?.id).toBe('legacy-message');
});

test('allows legacy image display from the media allowlist but never invents a forwarding source', () => {
  const collection = item({ payload: legacy('image', { image: { url: 'https://cdn.example.com/photo', width: 100, height: 80 } }) });
  expect(resolveCollectionContent(collection, 'me')).toMatchObject({ kind: 'image', imageUri: 'https://cdn.example.com/photo', width: 100, height: 80 });
  expect(getCollectionForwardItem(collection, 'me')).toBeNull();
  const unsafe = item({ payload: legacy('image', { image: { url: 'https://tracker.example.com/photo' } }) });
  expect(resolveCollectionContent(unsafe, 'me').imageUri).toBeUndefined();
});

test.each(['image', 'video', 'voice'])('never forwards a %s snapshot with a key but no confirmed source DTO', (type) => {
  const collection = item({ payload: legacy(type, { voice: { key: 'chat/me/voice', duration: 5 } }) });
  expect(getCollectionForwardItem(collection, 'me')).toBeNull();
  expect(getCollectionForwardItem(item({ message: source({ type, height: 0 }) }), 'me')).toBeNull();
});

test('does not convert unsupported or missing media into placeholder text forwarding', () => {
  expect(getCollectionForwardItem(item({ title: '[图片]', summary: '[图片]' }), 'me')).toBeNull();
  expect(getCollectionForwardItem(item({ payload: legacy('call-record'), title: '语音通话', summary: '通话结束' }), 'me')).toBeNull();
  expect(getCollectionForwardItem(item({ message: source({ type: 'unsupported', content: {} }) }), 'me')).toBeNull();
});

test.each([
  { type: 'verification-card', content: { invitationId: 'invitation' } },
  { type: 'plaza-post-card', content: { postId: 'post' } },
  { type: 'qr-card', content: { token: 'abcdefghijklmnopqrstuvwx12345678', qrType: 'user' } },
])('does not offer $type forwarding when the picker cannot send that card', ({ type, content }) => {
  const collection = item({ message: source({ type, content }), title: 'Card label', summary: 'Card label' });
  expect(resolveCollectionContent(collection, 'me').message?.type).toBe(type);
  expect(getCollectionForwardItem(collection, 'me')).toBeNull();
});

test.each([
  { type: 'note-card', content: { noteId: 'note' } },
  { type: 'friend-card', content: { userID: 'friend' } },
  { type: 'circle-card', content: { circleId: 'circle' } },
])('keeps $type forwarding supported by the picker', ({ type, content }) => {
  const collection = item({ message: source({ type, content }) });
  expect(getCollectionForwardItem(collection, 'me')?.dto?.type).toBe(type);
});

test('safely reconstructs known legacy friend cards for forwarding', () => {
  const collection = item({ payload: legacy('friend-card', { friendCard: {
    userID: 'friend', nickname: 'Friend', faceURL: 'https://tracker.example.com/avatar', displayIcons: 'invalid',
  } }) });
  expect(resolveCollectionContent(collection, 'me')).toMatchObject({ kind: 'friend-card', message: {
    friendCard: { userID: 'friend', nickname: 'Friend', faceURL: '', displayIcons: [] },
  } });
  expect(getCollectionForwardItem(collection, 'me')?.dto).toMatchObject({
    height: 0, type: 'friend-card', content: { userID: 'friend', faceURL: '', displayIcons: [] },
  });
});

test('maps server text direction using the current user instead of the collecting user', () => {
  const collection = item({ message: source({ type: 'text', content: { text: 'source text' }, sender: { id: 'me', nickname: 'Me', avatarUrl: null } }) });
  expect(resolveCollectionContent(collection, 'me')).toMatchObject({ kind: 'text', text: 'source text', message: { type: 'sent', outgoing: true } });
  expect(resolveCollectionContent(collection, 'other').message).toMatchObject({ type: 'received', outgoing: false, senderID: 'me' });
});

test('uses a useful summary once when old text collections have no payload', () => {
  const collection = item({ title: 'Saved text', summary: 'Saved text', payload: null });
  expect(resolveCollectionContent(collection, 'me')).toMatchObject({
    kind: 'text', text: 'Saved text', message: { id: 'collection:collection', text: 'Saved text' },
  });
  expect(getCollectionForwardItem(collection, 'me')?.message.text).toBe('Saved text');
});

test('uses saved full text if a legacy source text DTO has no usable text field', () => {
  const collection = item({ message: source({ type: 'text', content: {} }), payload: legacy('received', { text: 'saved complete text' }) });
  expect(resolveCollectionContent(collection, 'me')).toMatchObject({
    kind: 'text', text: 'saved complete text', message: { text: 'saved complete text' },
  });
});

test.each([{ deleted: true }, { revokedAt: '2026-11-02T00:00:00Z' }])('does not load or forward a removed source: %j', (overrides) => {
  const collection = item({ message: source(overrides) });
  expect(resolveCollectionContent(collection, 'me').message).toBeNull();
  expect(resolveCollectionContent(collection, 'me').imageUri).toBeUndefined();
  expect(getCollectionForwardItem(collection, 'me')).toBeNull();
});

test('requires the media DTO to refer to this collection source', () => {
  expect(getCollectionForwardItem(item({ message: source({ id: 'different-message' }) }), 'me')).toBeNull();
});

test('keeps the sender-stamped ephemeral forwarding restriction', () => {
  const collection = item({ message: source({ burnDurationSec: 30 }) });
  expect(getCollectionForwardItem(collection, 'me')).toBeNull();
  expect(getCollectionForwardItem(collection, 'peer')?.dto?.height).toBe(42);
});

test('forwards legacy note cards using the bounded card mapper', () => {
  const collection = item({ payload: legacy('note-card', { noteCard: {
    noteId: 'note', title: 'Saved note', coverUrl: 'https://tracker.example.com/cover',
    personalCardSnapshot: { id: 'owner', name: 'Owner', faceURL: 'https://tracker.example.com/avatar' },
  } }) });
  expect(getCollectionForwardItem(collection, 'me')?.dto).toMatchObject({
    height: 0, type: 'note-card', content: { noteId: 'note', coverUrl: null, personalCardSnapshot: { faceURL: null } },
  });
});
