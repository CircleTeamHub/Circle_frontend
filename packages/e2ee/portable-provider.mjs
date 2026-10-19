import { CipherSuite } from '@hpke/core';
import { Dhkem, HkdfSha256Native, toUint8Array, toArrayBuffer } from '@hpke/common';
import { X25519 } from '@hpke/dhkem-x25519';
import { extract, expand } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';
import { nobleCryptoProvider } from 'ts-mls';
import { makeGenericHpke } from 'ts-mls/crypto/implementation/hpke.js';
import { makeKdfImpl } from 'ts-mls/crypto/implementation/default/makeKdfImpl.js';

// Adapts established implementations; HPKE labels/key schedule remain in hpke-js.
// The application must install a platform CSPRNG before creating this provider.
// No fallback to Math.random, shared group keys, or plaintext is permitted.
class PortableHkdf extends HkdfSha256Native {
  async extract(salt, ikm) {
    return toArrayBuffer(extract(sha256, toUint8Array(ikm), toUint8Array(salt)));
  }
  async expand(prk, info, length) {
    return toArrayBuffer(expand(sha256, toUint8Array(prk), toUint8Array(info), length));
  }
  async extractAndExpand(salt, ikm, info, length) {
    const prk = await this.extract(salt, ikm);
    try { return await this.expand(prk, info, length); }
    finally { new Uint8Array(prk).fill(0); }
  }
}

class PortableX25519Kem extends Dhkem {
  constructor() {
    const kdf = new PortableHkdf();
    super(0x20, new X25519(kdf), kdf);
    this.secretSize = this.encSize = this.publicKeySize = this.privateKeySize = 32;
  }
}

const aes128 = {
  id: 1, keySize: 16, nonceSize: 12, tagSize: 16,
  createEncryptionContext(rawKey) {
    const key = toUint8Array(rawKey);
    if (key.length !== 16) throw new Error('Invalid AES-128 key length');
    return {
      async seal(nonce, plaintext, aad) {
        return toArrayBuffer(gcm(key, toUint8Array(nonce), toUint8Array(aad)).encrypt(toUint8Array(plaintext)));
      },
      async open(nonce, ciphertext, aad) {
        return toArrayBuffer(gcm(key, toUint8Array(nonce), toUint8Array(aad)).decrypt(toUint8Array(ciphertext)));
      },
    };
  },
};

export const portableCryptoProvider = {
  async getCiphersuiteImpl(suite) {
    if (suite.name !== 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519') throw new Error('Unsupported MLS ciphersuite');
    if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Platform secure random generator is required');
    const base = await nobleCryptoProvider.getCiphersuiteImpl(suite);
    const cipherSuite = new CipherSuite({ kem: new PortableX25519Kem(), kdf: new PortableHkdf(), aead: aes128 });
    const aead = {
      async encrypt(key, nonce, aad, plaintext) { return gcm(key, nonce, aad).encrypt(plaintext); },
      async decrypt(key, nonce, aad, ciphertext) { return gcm(key, nonce, aad).decrypt(ciphertext); },
    };
    return { ...base, kdf: makeKdfImpl(new PortableHkdf()), hpke: await makeGenericHpke(suite.hpke, aead, cipherSuite) };
  },
};
