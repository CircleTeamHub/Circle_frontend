import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { b64, unb64 } from './protocol.mjs';
import { sealJournal, openJournal } from './journal-codec.mjs';

const utf8 = value => new TextEncoder().encode(value);
export function createRecoveryCode() {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  try {
    return `CER1-${bytesToHex(secret)}-${bytesToHex(sha256(secret)).slice(0, 8)}`;
  } finally { secret.fill(0); }
}

// Recovery restores archive keys and authorizes a FRESH identity. No MLS sending
// ratchet, old device signing key, or one-time KeyPackage is ever backed up.
export function openRecoveryKey(code, userId, purpose) {
  const compact = code.trim().replace(/\s/g, '').toLowerCase();
  if (!/^cer1-[a-f0-9]{64}-[a-f0-9]{8}$/.test(compact)) throw new Error('Invalid recovery code');
  const secret = hexToBytes(compact.split('-')[1]);
  let material;
  try {
    if (bytesToHex(sha256(secret)).slice(0, 8) !== compact.split('-')[2]) throw new Error('Recovery code checksum mismatch');
    material = hkdf(sha256, secret, utf8('circle-recovery-v1'), utf8(JSON.stringify([userId, purpose])), 64);
  } finally { secret.fill(0); }
  const encryption = material.subarray(0, 32), signing = material.subarray(32);
  const publicKey = b64(ed25519.getPublicKey(signing));
  let closed = false;
  const check = () => { if (closed) throw new Error('Recovery key locked'); };
  const scope = (recoveryId, ref) => JSON.stringify(['circle-history-v1', userId, purpose, recoveryId, ref]);
  return {
    publicKey,
    sign(action, payload) { check(); return b64(ed25519.sign(utf8(JSON.stringify(['circle-e2ee-action-v1', action, payload])), signing)); },
    seal(recoveryId, ref, value) { check(); return b64(sealJournal(encryption, scope(recoveryId, ref), 1, value)); },
    open(recoveryId, ref, sealed) { check(); return openJournal(encryption, scope(recoveryId, ref), 1, unb64(sealed)); },
    close() { closed = true; material.fill(0); },
  };
}
