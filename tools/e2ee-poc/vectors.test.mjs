import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getCiphersuiteImpl, getCiphersuiteFromName } from 'ts-mls';
import { portableCryptoProvider } from './portable-provider.mjs';
import { deriveSecret, deriveTreeSecret, expandWithLabel } from 'ts-mls/crypto/kdf.js';
import { signWithLabel, verifyWithLabel } from 'ts-mls/crypto/signature.js';
import { decryptWithLabel } from 'ts-mls/crypto/hpke.js';
import { refhash } from 'ts-mls/crypto/hash.js';

// Independent inputs/expected values from mlswg; provenance is in fixtures/SOURCE.json.
const vectors = JSON.parse(readFileSync(new URL('./fixtures/mlswg-suite1-crypto-basics.json', import.meta.url)));
const cs = await getCiphersuiteImpl(getCiphersuiteFromName('MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519'), portableCryptoProvider);
const hex = value => new Uint8Array(Buffer.from(value, 'hex'));
const equalHex = (actual, expected) => assert.equal(Buffer.from(actual).toString('hex'), expected);

test('mlswg suite 1: DeriveSecret', async () => {
  const v = vectors.derive_secret;
  equalHex(await deriveSecret(hex(v.secret), v.label, cs.kdf), v.out);
});
test('mlswg suite 1: DeriveTreeSecret', async () => {
  const v = vectors.derive_tree_secret;
  equalHex(await deriveTreeSecret(hex(v.secret), v.label, v.generation, v.length, cs.kdf), v.out);
});
test('mlswg suite 1: ExpandWithLabel', async () => {
  const v = vectors.expand_with_label;
  equalHex(await expandWithLabel(hex(v.secret), v.label, hex(v.context), v.length, cs.kdf), v.out);
});
test('mlswg suite 1: RefHash', async () => {
  const v = vectors.ref_hash;
  equalHex(await refhash(v.label, hex(v.value), cs.hash), v.out);
});
test('mlswg suite 1: SignWithLabel and signature rejection', async () => {
  const v = vectors.sign_with_label;
  equalHex(await signWithLabel(hex(v.priv), v.label, hex(v.content), cs.signature), v.signature);
  assert.equal(await verifyWithLabel(hex(v.pub), v.label, hex(v.content), hex(v.signature), cs.signature), true);
  assert.equal(await verifyWithLabel(hex(v.pub), 'wrong-label', hex(v.content), hex(v.signature), cs.signature), false);
});
test('mlswg suite 1: HPKE decrypts external ciphertext and rejects wrong context', async () => {
  const v = vectors.encrypt_with_label;
  const key = await cs.hpke.importPrivateKey(hex(v.priv));
  equalHex(await decryptWithLabel(key, v.label, hex(v.context), hex(v.kem_output), hex(v.ciphertext), cs.hpke), v.plaintext);
  await assert.rejects(decryptWithLabel(key, 'wrong-label', hex(v.context), hex(v.kem_output), hex(v.ciphertext), cs.hpke));
});
