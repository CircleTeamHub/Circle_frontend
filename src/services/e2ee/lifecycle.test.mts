import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptedBodyPurgeMatches, hasEncryptedBodyPurgeTarget } from './lifecycle.ts';

// 本机加密正文库的清理条件。单条清理缺了标识时原来会退化成「整个会话都匹配」:一条
// 没带信封的加密消息(撤回后正文为空)焚毁到期,就把这个会话里所有加密正文一起删了。
const body = (
  clientMessageId: string,
  extra: { conversationId?: string; serverMessageId?: string; expiresAt?: string } = {},
) => ({ conversationId: 'room', clientMessageId, ...extra });
const NOW = Date.parse('2026-10-24T12:00:00.000Z');

test('a single-message purge without any identifier matches nothing', () => {
  const purge = { conversationId: 'room' };
  assert.equal(hasEncryptedBodyPurgeTarget(purge), false);
  assert.equal(encryptedBodyPurgeMatches(purge, body('a'), NOW), false);
  assert.equal(
    encryptedBodyPurgeMatches({ conversationId: 'room', clientMessageId: '' }, body('a'), NOW),
    false,
  );
});

test('clearing a whole conversation has to say so', () => {
  const purge = { conversationId: 'room', wholeConversation: true };
  assert.equal(hasEncryptedBodyPurgeTarget(purge), true);
  assert.equal(encryptedBodyPurgeMatches(purge, body('a'), NOW), true);
  assert.equal(
    encryptedBodyPurgeMatches(purge, body('b', { conversationId: 'other' }), NOW),
    false,
  );
});

test('a single-message purge matches only that message', () => {
  const byClient = { conversationId: 'room', clientMessageId: 'a' };
  assert.equal(encryptedBodyPurgeMatches(byClient, body('a'), NOW), true);
  assert.equal(encryptedBodyPurgeMatches(byClient, body('b'), NOW), false);
  assert.equal(
    encryptedBodyPurgeMatches(byClient, body('a', { conversationId: 'other' }), NOW),
    false,
  );

  const byServer = { conversationId: 'room', serverMessageId: 'srv-1' };
  assert.equal(
    encryptedBodyPurgeMatches(byServer, body('a', { serverMessageId: 'srv-1' }), NOW),
    true,
  );
  assert.equal(encryptedBodyPurgeMatches(byServer, body('b'), NOW), false);
});

test('an expiry sweep matches bodies past their expiry in any conversation', () => {
  const purge = { expired: true };
  assert.equal(
    encryptedBodyPurgeMatches(
      purge,
      body('a', { conversationId: 'other', expiresAt: '2026-10-24T11:59:59.000Z' }),
      NOW,
    ),
    true,
  );
  assert.equal(
    encryptedBodyPurgeMatches(purge, body('b', { expiresAt: '2026-10-24T12:00:01.000Z' }), NOW),
    false,
  );
  assert.equal(encryptedBodyPurgeMatches(purge, body('c'), NOW), false);
});
