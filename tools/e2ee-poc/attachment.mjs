import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { gcm } from '@noble/ciphers/aes.js';

// Bounded one-shot laboratory media path. Large-file streaming is a separate
// mobile integration gate; do not concatenate unbounded video files in JS.
export function encryptAttachment(plaintext, conversationId) {
  if (!(plaintext instanceof Uint8Array) || plaintext.length > 8 * 1024 * 1024) throw new Error('Attachment exceeds laboratory limit');
  const key = randomBytes(32), nonce = randomBytes(12);
  const objectId = randomBytes(24).toString('hex');
  const aad = new TextEncoder().encode(JSON.stringify(['circle-attachment-v1', conversationId, objectId]));
  const ciphertext = gcm(key, nonce, aad).encrypt(plaintext);
  const reference = { version: 1, objectId, conversationId, key: key.toString('base64'), nonce: nonce.toString('base64'), size: ciphertext.length };
  key.fill(0);
  return { ciphertext, reference }; // Only ciphertext goes to object storage; reference goes inside MLS.
}
export function decryptAttachment(ciphertext, reference, conversationId) {
  if (reference.version !== 1 || reference.conversationId !== conversationId || ciphertext.length !== reference.size || ciphertext.length > 8 * 1024 * 1024 + 16) throw new Error('Attachment context mismatch');
  const aad = new TextEncoder().encode(JSON.stringify(['circle-attachment-v1', conversationId, reference.objectId]));
  const key = Buffer.from(reference.key, 'base64');
  try { return gcm(key, Buffer.from(reference.nonce, 'base64'), aad).decrypt(ciphertext); }
  finally { key.fill(0); }
}
