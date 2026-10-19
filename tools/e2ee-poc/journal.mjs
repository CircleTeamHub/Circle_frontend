import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Local protocol laboratory. The mobile adapter must supply a device-bound
// Keychain/Keystore key and the same atomic compare-and-swap semantics.
export class EncryptedJournal {
  constructor(path, key, deviceId) {
    if (key.length !== 32) throw new Error('A 256-bit storage key is required');
    this.key = Buffer.from(key);
    this.deviceId = deviceId;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, sealed BLOB NOT NULL)');
  }
  aad(revision) { return Buffer.from(JSON.stringify(['circle-mls-journal-v1', this.deviceId, revision])); }
  seal(record, revision) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(this.aad(revision));
    const plaintext = Buffer.from(JSON.stringify(record));
    try {
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    } finally { plaintext.fill(0); }
  }
  load() {
    const row = this.db.prepare('SELECT revision, sealed FROM journal WHERE id=1').get();
    if (!row) return { revision: 0, record: null };
    const blob = Buffer.from(row.sealed);
    const decipher = createDecipheriv('aes-256-gcm', this.key, blob.subarray(0, 12));
    decipher.setAAD(this.aad(row.revision));
    decipher.setAuthTag(blob.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
    try { return { revision: row.revision, record: JSON.parse(plaintext.toString()) }; }
    finally { plaintext.fill(0); }
  }
  save(expectedRevision, record, beforeCommit) {
    const next = expectedRevision + 1;
    const sealed = this.seal(record, next);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = expectedRevision === 0
        ? this.db.prepare('INSERT OR IGNORE INTO journal(id, revision, sealed) VALUES(1, ?, ?)').run(next, sealed)
        : this.db.prepare('UPDATE journal SET revision=?, sealed=? WHERE id=1 AND revision=?').run(next, sealed, expectedRevision);
      if (result.changes !== 1) throw new Error('Concurrent state change: reload before retry');
      beforeCommit?.();
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); this.key.fill(0); }
}
