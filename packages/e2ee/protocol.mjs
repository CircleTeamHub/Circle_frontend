import base64 from 'base64-js';
import { getItem, pageItems } from './archive-store.mjs';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { equalBytes } from '@noble/ciphers/utils.js';
import {
  getCiphersuiteImpl, getCiphersuiteFromName,
  generateKeyPackageWithKey, defaultCapabilities, defaultLifetime,
  createGroup, joinGroup, createCommit, createApplicationMessage,
  processPrivateMessage, emptyPskIndex, encodeMlsMessage, decodeMlsMessage,
  encodeGroupState, decodeGroupState, zeroOutUint8Array,
} from 'ts-mls';
import { defaultClientConfig } from 'ts-mls/clientConfig.js';
import { decryptSenderData } from 'ts-mls/privateMessage.js';
import { getCredentialFromLeafIndex } from 'ts-mls/ratchetTree.js';
import { portableCryptoProvider } from './portable-provider.mjs';

const suite = getCiphersuiteFromName('MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519');
const bytes = value => new TextEncoder().encode(value);
const text = value => new TextDecoder('utf-8', { fatal: true }).decode(value);
export const b64 = value => base64.fromByteArray(value);
export const unb64 = value => {
  if (typeof value !== 'string' || value.length > 1_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid base64');
  return base64.toByteArray(value);
};
function decode(decoder, value) {
  const result = decoder(value, 0);
  if (!result || result[1] !== value.length) throw new Error('Malformed or trailing MLS data');
  return result[0];
}
function identity(userId, deviceId) { return JSON.stringify(['circle-device-v1', userId, deviceId]); }
function same(a, b) { return a.length === b.length && equalBytes(a, b); }
function metadata(e) { return bytes(JSON.stringify(['circle-mls-v1', e.conversationId, e.senderDeviceId, e.clientMessageId, e.epoch])); }
function digest(body) { return bytesToHex(sha256(bytes(JSON.stringify(body)))); }
function checkId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(value) || Object.hasOwn(Object.prototype, value)) throw new Error('Invalid identifier');
}
function invitationContext(conversationId, managerDeviceId, welcome) {
  return bytes(JSON.stringify(['circle-mls-invitation-v1', conversationId, managerDeviceId, welcome]));
}

// Trust pins are supplied out of band by the harness. A server response alone
// must never populate them. This is deliberately not an automatic TOFU flow.
export class ProtocolDevice {
  static async open(journal, userId, deviceId, pins, provider = portableCryptoProvider) {
    checkId(userId); checkId(deviceId);
    const impl = await getCiphersuiteImpl(suite, provider);
    const device = new ProtocolDevice(journal, userId, deviceId, pins, impl);
    const { record, revision } = await journal.load();
    if (!record) {
      const key = await impl.signature.keygen();
      await journal.save(revision, { userId, deviceId, signing: { publicKey: b64(key.publicKey), signKey: b64(key.signKey) }, pending: null, groups: {}, outbox: {}, inbox: {} });
      key.signKey.fill(0);
    } else if (record.userId !== userId || record.deviceId !== deviceId) throw new Error('Wrong device journal');
    const stored = (await journal.load()).record;
    device.identity = { userId, deviceId, publicKey: stored.signing.publicKey };
    for (const pin of Object.values(stored.trustedDevices ?? {})) pins.set(pin.deviceId, pin);
    return device;
  }
  constructor(journal, userId, deviceId, pins, impl) {
    Object.assign(this, { journal, userId, deviceId, pins, impl });
    this.config = {
      ...defaultClientConfig,
      authService: { validateCredential: async (credential, key) => {
        if (credential.credentialType !== 'basic') return false;
        return [...pins.values()].some(pin => text(credential.identity) === identity(pin.userId, pin.deviceId) && same(unb64(pin.publicKey), key));
      } },
    };
  }
  publicIdentity() { return { ...this.identity }; }
  state(record, id) {
    checkId(id);
    const group = record.groups[id];
    if (!group) throw new Error('Device is not in this conversation');
    return { ...decode(decodeGroupState, unb64(group.state)), clientConfig: this.config };
  }
  async publishKeyPackage() {
    const { record, revision } = await this.journal.load();
    if (!record.pending) {
      const kp = await generateKeyPackageWithKey(
        { credentialType: 'basic', identity: bytes(identity(this.userId, this.deviceId)) },
        defaultCapabilities(), defaultLifetime, [],
        { publicKey: unb64(record.signing.publicKey), signKey: unb64(record.signing.signKey) }, this.impl,
      );
      record.pending = {
        public: b64(encodeMlsMessage({ version: 'mls10', wireformat: 'mls_key_package', keyPackage: kp.publicPackage })),
        private: Object.fromEntries(Object.entries(kp.privatePackage).map(([key, value]) => [key, b64(value)])),
      };
      await this.journal.save(revision, record);
      Object.values(kp.privatePackage).forEach(zeroOutUint8Array);
    }
    return record.pending.public;
  }
  pending(record) {
    if (!record.pending) throw new Error('Key package is missing or already consumed');
    const packet = decode(decodeMlsMessage, unb64(record.pending.public));
    return { public: packet.keyPackage, private: Object.fromEntries(Object.entries(record.pending.private).map(([key, value]) => [key, unb64(value)])) };
  }
  async create(conversationId) {
    checkId(conversationId);
    await this.publishKeyPackage();
    const { record, revision } = await this.journal.load();
    if (record.groups[conversationId]) throw new Error('Conversation already exists');
    const kp = this.pending(record);
    const state = await createGroup(bytes(conversationId), kp.public, kp.private, [], this.impl, this.config);
    record.groups[conversationId] = { state: b64(encodeGroupState(state)), manager: this.deviceId };
    record.pending = null;
    await this.journal.save(revision, record);
  }
  async changeMembers(conversationId, id, { add = [], remove = [] } = {}, beforeCommit) {
    checkId(conversationId); checkId(id);
    const { record, revision } = await this.journal.load();
    if (record.groups[conversationId]?.manager !== this.deviceId) throw new Error('Only the pinned manager can change the laboratory group');
    const fingerprint = digest({ conversationId, add, remove });
    const existing = await getItem(this.journal, record, 'outbox', id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('Idempotency conflict');
      return existing.packet;
    }
    const state = this.state(record, conversationId);
    const proposals = [];
    for (const encoded of add) {
      const kp = decode(decodeMlsMessage, unb64(encoded));
      if (kp.wireformat !== 'mls_key_package' || !await this.config.authService.validateCredential(kp.keyPackage.leafNode.credential, kp.keyPackage.leafNode.signaturePublicKey)) throw new Error('Unapproved device identity');
      proposals.push({ proposalType: 'add', add: { keyPackage: kp.keyPackage } });
    }
    for (const deviceId of remove) {
      const pin = this.pins.get(deviceId);
      const index = state.ratchetTree.findIndex(node => node?.nodeType === 'leaf' && text(node.leaf.credential.identity) === identity(pin?.userId, deviceId));
      if (index < 0) throw new Error('Device is not a group member');
      proposals.push({ proposalType: 'remove', remove: { removed: index / 2 } });
    }
    const result = await createCommit({ state, cipherSuite: this.impl }, { extraProposals: proposals, ratchetTreeExtension: true });
    const packet = { commit: b64(encodeMlsMessage(result.commit)), welcome: null };
    if (result.welcome) {
      const encoded = b64(encodeMlsMessage({ version: 'mls10', wireformat: 'mls_welcome', welcome: result.welcome }));
      const key = unb64(record.signing.signKey);
      try {
        packet.welcome = { encoded, signature: b64(await this.impl.signature.sign(key, invitationContext(conversationId, this.deviceId, encoded))) };
      } finally { key.fill(0); }
    }
    record.groups[conversationId].state = b64(encodeGroupState(result.newState));
    record.outbox[id] = { fingerprint, packet };
    await this.journal.save(revision, record, beforeCommit);
    result.consumed.forEach(zeroOutUint8Array);
    return packet;
  }
  async join(conversationId, managerDeviceId, invitation) {
    checkId(conversationId); checkId(managerDeviceId);
    const { record, revision } = await this.journal.load();
    if (record.groups[conversationId] || !this.pins.has(managerDeviceId)) throw new Error('Unapproved or existing group');
    const manager = this.pins.get(managerDeviceId);
    if (!await this.impl.signature.verify(unb64(manager.publicKey), invitationContext(conversationId, managerDeviceId, invitation.encoded), unb64(invitation.signature))) throw new Error('Unapproved group invitation');
    const welcome = decode(decodeMlsMessage, unb64(invitation.encoded));
    if (welcome.wireformat !== 'mls_welcome') throw new Error('Expected MLS Welcome');
    const kp = this.pending(record);
    const state = await joinGroup(welcome.welcome, kp.public, kp.private, emptyPskIndex, this.impl, undefined, undefined, this.config);
    if (!same(state.groupContext.groupId, bytes(conversationId))) throw new Error('Wrong conversation');
    record.groups[conversationId] = { state: b64(encodeGroupState(state)), manager: managerDeviceId };
    record.pending = null;
    await this.journal.save(revision, record);
  }
  async receiveCommit(conversationId, encoded, committerDeviceId) {
    const { record, revision } = await this.journal.load();
    const state = this.state(record, conversationId);
    const packet = decode(decodeMlsMessage, unb64(encoded));
    if (packet.wireformat !== 'mls_private_message' || packet.privateMessage.contentType !== 'commit') throw new Error('Expected encrypted commit');
    const result = await processPrivateMessage(state, packet.privateMessage, emptyPskIndex, this.impl, incoming => {
      if (incoming.kind !== 'commit' || incoming.senderLeafIndex === undefined) return 'reject';
      const credential = getCredentialFromLeafIndex(state.ratchetTree, incoming.senderLeafIndex);
      const pin = this.pins.get(committerDeviceId ?? record.groups[conversationId].manager);
      return pin && text(credential.identity) === identity(pin.userId, pin.deviceId) ? 'accept' : 'reject';
    });
    if (result.kind !== 'newState' || result.actionTaken !== 'accept') throw new Error('Unauthorized membership change');
    record.groups[conversationId].state = b64(encodeGroupState(result.newState));
    await this.journal.save(revision, record);
    result.consumed.forEach(zeroOutUint8Array);
  }
  async send(conversationId, clientMessageId, body, beforeCommit) {
    checkId(conversationId); checkId(clientMessageId);
    const { record, revision } = await this.journal.load();
    const fingerprint = digest({ conversationId, body });
    const existing = await getItem(this.journal, record, 'outbox', clientMessageId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('Idempotency conflict');
      return existing.packet;
    }
    const state = this.state(record, conversationId);
    const envelope = { version: 1, protocol: 'mls10', conversationId, senderDeviceId: this.deviceId, clientMessageId, epoch: state.groupContext.epoch.toString() };
    const plaintext = bytes(JSON.stringify(body));
    if (plaintext.length > 8 * 1024) throw new Error('Application message too large');
    const result = await createApplicationMessage(state, plaintext, this.impl, metadata(envelope));
    plaintext.fill(0);
    envelope.ciphertext = b64(encodeMlsMessage({ version: 'mls10', wireformat: 'mls_private_message', privateMessage: result.privateMessage }));
    record.groups[conversationId].state = b64(encodeGroupState(result.newState));
    record.outbox[clientMessageId] = { fingerprint, packet: envelope };
    record.inbox[digest([conversationId, this.deviceId, clientMessageId])] = { conversationId, senderDeviceId: this.deviceId, clientMessageId, ciphertext: envelope.ciphertext, body };
    // Ciphertext is not returned to the transport until ratchet and outbox commit together.
    await this.journal.save(revision, record, beforeCommit);
    result.consumed.forEach(zeroOutUint8Array);
    return envelope;
  }
  async receive(envelope, beforeCommit) {
    if (envelope.version !== 1 || envelope.protocol !== 'mls10' || typeof envelope.epoch !== 'string') throw new Error('Unsupported encrypted envelope');
    for (const key of ['conversationId', 'senderDeviceId', 'clientMessageId']) checkId(envelope[key]);
    const { record, revision } = await this.journal.load();
    const inboxId = digest([envelope.conversationId, envelope.senderDeviceId, envelope.clientMessageId]);
    if (await getItem(this.journal, record, 'inbox', inboxId)) throw new Error('Message already received');
    const state = this.state(record, envelope.conversationId);
    const packet = decode(decodeMlsMessage, unb64(envelope.ciphertext));
    const pm = packet.privateMessage;
    if (packet.wireformat !== 'mls_private_message' || pm.contentType !== 'application' || pm.epoch.toString() !== envelope.epoch || !same(pm.groupId, bytes(envelope.conversationId)) || !same(pm.authenticatedData, metadata(envelope))) throw new Error('Envelope context mismatch');
    const receiver = pm.epoch === state.groupContext.epoch ? { senderDataSecret: state.keySchedule.senderDataSecret, ratchetTree: state.ratchetTree } : state.historicalReceiverData.get(pm.epoch);
    if (!receiver) throw new Error('Unknown epoch');
    const sender = await decryptSenderData(pm, receiver.senderDataSecret, this.impl);
    if (!sender) throw new Error('Invalid MLS sender');
    const credential = getCredentialFromLeafIndex(receiver.ratchetTree, sender.leafIndex);
    const pin = this.pins.get(envelope.senderDeviceId);
    if (!pin || text(credential.identity) !== identity(pin.userId, pin.deviceId)) throw new Error('Sender identity mismatch');
    const result = await processPrivateMessage(state, pm, emptyPskIndex, this.impl);
    if (result.kind !== 'applicationMessage') throw new Error('Expected application message');
    const body = JSON.parse(text(result.message));
    record.groups[envelope.conversationId].state = b64(encodeGroupState(result.newState));
    record.inbox[inboxId] = { conversationId: envelope.conversationId, senderDeviceId: envelope.senderDeviceId, clientMessageId: envelope.clientMessageId, ciphertext: envelope.ciphertext, body };
    await this.journal.save(revision, record, beforeCommit);
    result.message.fill(0);
    result.consumed.forEach(zeroOutUint8Array);
    return body;
  }
  async message(envelope) {
    const { record } = await this.journal.load();
    return getItem(this.journal, record, 'inbox', digest([envelope.conversationId, envelope.senderDeviceId, envelope.clientMessageId]));
  }
  async messagePage(after = '', limit = 50) { return pageItems(this.journal, 'inbox', after, limit); }
  async messages() {
    const all = []; let after = '';
    for (;;) { const page = await this.messagePage(after, 100); all.push(...page.map(v => v.value)); if (page.length < 100) return all; after = page.at(-1).id; }
  }
  async importMessage(message) {
    const { record, revision } = await this.journal.load();
    const id = digest([message.conversationId, message.senderDeviceId, message.clientMessageId]);
    const existing = await getItem(this.journal, record, 'inbox', id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(message)) throw new Error('Conflicting archived message');
    if (!existing) { record.inbox[id] = message; await this.journal.save(revision, record); }
  }
  async confirmIdentity(pin) {
    checkId(pin.userId); checkId(pin.deviceId);
    if (unb64(pin.publicKey).length !== 32) throw new Error('Invalid identity key');
    pin = { userId: pin.userId, deviceId: pin.deviceId, publicKey: pin.publicKey };
    const previous = this.pins.get(pin.deviceId);
    if (previous && (previous.userId !== pin.userId || previous.publicKey !== pin.publicKey)) throw new Error('Device key changed');
    const { record, revision } = await this.journal.load();
    record.trustedDevices ??= {};
    record.trustedDevices[pin.deviceId] = pin;
    await this.journal.save(revision, record);
    this.pins.set(pin.deviceId, pin);
  }
  async signPayload(action, payload) {
    const { record } = await this.journal.load();
    const key = unb64(record.signing.signKey);
    try { return b64(await this.impl.signature.sign(key, bytes(JSON.stringify(['circle-e2ee-action-v1', action, payload])))); }
    finally { key.fill(0); }
  }
  async verifyPayload(pin, action, payload, signature) {
    return this.impl.signature.verify(unb64(pin.publicKey), bytes(JSON.stringify(['circle-e2ee-action-v1', action, payload])), unb64(signature));
  }
  async snapshot(conversationId) {
    const { record } = await this.journal.load();
    const state = this.state(record, conversationId);
    return { epoch: state.groupContext.epoch.toString(), managerDeviceId: record.groups[conversationId].manager, devices: state.ratchetTree.filter(node => node?.nodeType === 'leaf').map(node => { const value = JSON.parse(text(node.leaf.credential.identity)); return { userId: value[1], deviceId: value[2] }; }) };
  }
}
