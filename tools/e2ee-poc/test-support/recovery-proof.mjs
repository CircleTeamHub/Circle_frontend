import { createPublicKey, verify } from 'node:crypto';
export function verifyDeviceProof(key, action, payload, signature) {
  return verify(null, Buffer.from(JSON.stringify(['circle-e2ee-action-v1', action, payload])), createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key, 'base64')]), format: 'der', type: 'spki' }), Buffer.from(signature, 'base64'));
}
