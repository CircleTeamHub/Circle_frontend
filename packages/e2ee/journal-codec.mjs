import { gcm } from '@noble/ciphers/aes.js';

const utf8 = new TextEncoder();
const context = (scope, revision) => utf8.encode(JSON.stringify(['circle-e2ee-storage-v1', scope, revision]));

export function sealJournal(key, scope, revision, record) {
  if (key.length !== 32 || !Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid journal parameters');
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const clear = utf8.encode(JSON.stringify(record));
  try {
    const cipher = gcm(key, nonce, context(scope, revision)).encrypt(clear);
    const sealed = new Uint8Array(nonce.length + cipher.length);
    sealed.set(nonce); sealed.set(cipher, nonce.length);
    return sealed;
  } finally { clear.fill(0); }
}

export function openJournal(key, scope, revision, sealed) {
  if (key.length !== 32 || sealed.length < 28 || !Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid journal parameters');
  const clear = gcm(key, sealed.subarray(0, 12), context(scope, revision)).decrypt(sealed.subarray(12));
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clear)); }
  finally { clear.fill(0); }
}
