import { createRecoveryCode, openRecoveryKey } from './recovery.mjs';
// Device-side coordination. Transport receives only public identities, signed
// membership operations and MLS ciphertext. All durable private state is journaled.
export class EncryptionClient {
  constructor(device, request, uuid, purpose = 'APP') {
    this.device = device; this.request = request; this.uuid = uuid; this.purpose = purpose;
    this.base = purpose === 'AUDIT' ? '/admin/e2ee' : '/e2ee';
    this.tail = Promise.resolve();
  }
  run(work) {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
  async signed(action, payload) { return { actorDeviceId: this.device.deviceId, signature: await this.device.signPayload(action, payload) }; }
  async register(label) {
    const d = this.device; const pin = d.publicIdentity();
    const result = await this.request(`${this.base}/devices`, 'POST', { deviceId: pin.deviceId, publicKey: pin.publicKey, label, signature: await d.signPayload('register', [d.userId, this.purpose, d.deviceId, pin.publicKey, label]) });
    await d.confirmIdentity(pin);
    if (result.status === 'ACTIVE') await this.publish();
    return result;
  }
  async publish() {
    const d = this.device; const encoded = await d.publishKeyPackage();
    return this.request(`${this.base}/packages`, 'POST', { encoded, ...await this.signed('package', [d.userId, this.purpose, d.deviceId, encoded]) });
  }
  async devices() { return this.request(`${this.base}/devices`, 'GET'); }
  // Call only after the user verifies fingerprints on the counterpart devices.
  async trust(devices) {
    for (const value of devices) {
      const pin = { userId: value.userID, deviceId: value.id, publicKey: value.publicKey };
      await this.device.confirmIdentity(pin);
      const { record, revision } = await this.device.journal.load();
      record.devicePurposes ??= {};
      if (record.devicePurposes[value.id] && record.devicePurposes[value.id] !== value.purpose) throw new Error('Device purpose changed');
      record.devicePurposes[value.id] = value.purpose;
      await this.device.journal.save(revision, record);
    }
  }
  async deviceAction(target, action) {
    const d = this.device;
    if (!d.pins.has(target.id) && action === 'approve') throw new Error('Verify the new device fingerprint before approval');
    return this.request(`${this.base}/devices/${target.id}/${action}`, 'POST', await this.signed(action, [d.userId, this.purpose, target.id, target.publicKey, d.deviceId]));
  }
  async directory(id) { return this.request(`${this.base}/conversations/${id}`, 'GET'); }
  async isEncrypted(id) { return Boolean((await this.device.journal.load()).record.groups[id]); }
  async enable(id) {
    const d = this.device;
    const directory = await this.directory(id);
    if (directory.room && directory.room.managerDeviceID !== d.deviceId) throw new Error('Another device manages encryption');
    this.validateCandidates(directory);
    if (!await this.isEncrypted(id)) await d.create(id);
    await this.request(`/e2ee/conversations/${id}`, 'POST', await this.signed('create', [d.userId, id, d.deviceId]));
    await this.publish();
    await this.reconcile(id);
  }
  validateCandidates(directory) {
    const devices = directory.devices;
    if (!devices.some(v => v.purpose === 'AUDIT')) throw new Error('An authorized administrator device is required');
    if (directory.members.some(id => !devices.some(v => v.userID === id && v.purpose === 'APP'))) throw new Error('Every participant must register an encryption device first');
    for (const device of devices) {
      const pin = this.device.pins.get(device.id);
      if (!pin || pin.userId !== device.userID || pin.publicKey !== device.publicKey) throw new Error('Verify all device fingerprints before enabling encryption');
    }
  }
  async flushPending() {
    const d = this.device;
    const pending = (await d.journal.load()).record.pendingEpoch;
    if (!pending) return;
    const packet = await d.changeMembers(pending.id, pending.operationId, { add: pending.packages.map(p => p.encoded), remove: pending.remove });
    const fields = [d.userId, pending.id, d.deviceId, pending.operationId, pending.expectedEpoch, pending.packages.map(p => p.id), pending.remove, packet.commit, packet.welcome];
    await this.request(`${this.base}/conversations/${pending.id}/epochs`, 'POST', { operationId: pending.operationId, expectedEpoch: pending.expectedEpoch, packageIds: pending.packages.map(p => p.id), removeDeviceIds: pending.remove, commit: packet.commit, ...(packet.welcome ? { welcome: packet.welcome } : {}), ...await this.signed('epoch', fields) });
    const { record, revision } = await d.journal.load();
    delete record.pendingEpoch;
    await d.journal.save(revision, record);
  }
  async reconcile(id) {
    await this.flushPending();
    const d = this.device; let directory = await this.directory(id);
    this.validateCandidates(directory);
    if (directory.room?.managerDeviceID !== d.deviceId) {
      if (directory.devices.some(v => v.id === directory.room?.managerDeviceID)) return;
      await this.sync(id, this.purpose === 'AUDIT' ? 'Restore conversation after device loss' : undefined);
      await this.request(`${this.base}/conversations/${id}/takeover`, 'POST', await this.signed('takeover', [d.userId, this.purpose, id, d.deviceId]));
      directory = await this.directory(id);
    }
    const state = await d.snapshot(id);
    const adds = directory.devices.filter(v => !state.devices.some(s => s.deviceId === v.id));
    const remove = state.devices.filter(v => !directory.devices.some(s => s.id === v.deviceId)).map(v => v.deviceId);
    if (!adds.length && !remove.length) return;
    const packages = [];
    for (const device of adds) {
      const kp = device.packages[0];
      if (!kp || !await d.verifyPayload(d.pins.get(device.id), 'package', [device.userID, device.purpose, device.id, kp.encoded], kp.signature)) throw new Error('A verified one-time key package is required');
      packages.push(kp);
    }
    const { record, revision } = await d.journal.load();
    record.groups[id].manager = d.deviceId;
    record.pendingEpoch = { id, operationId: this.uuid(), expectedEpoch: Number(state.epoch), packages, remove };
    await d.journal.save(revision, record);
    await this.flushPending();
  }
  async sync(id, reason) {
    const d = this.device;
    await this.flushPending();
    for (let page = 0; page < 100; page++) {
      const current = await this.isEncrypted(id) ? await d.snapshot(id) : null;
      const afterEpoch = Number(current?.epoch ?? 0);
      const response = await this.request(`${this.base}/conversations/${id}/events`, 'POST', { afterEpoch, ...(reason ? { reason } : {}), ...await this.signed('events', [d.userId, this.purpose, id, d.deviceId, afterEpoch, reason ?? null]) });
      for (const value of response.devices) {
        const pin = d.pins.get(value.id);
        if (pin && (pin.userId !== value.userID || pin.publicKey !== value.publicKey)) throw new Error('Conversation device fingerprint changed');
        // Removed historical devices are not trust prerequisites for a fresh
        // Welcome. MLS validates every actual leaf against locally confirmed pins.
      }
      for (const event of response.events) {
        const payload = event.packet.payload;
        const committer = Array.isArray(payload) ? d.pins.get(payload[2]) : null;
        if (!committer || payload[0] !== committer.userId || payload[1] !== id || payload[4] !== event.epoch - 1 || payload[7] !== event.packet.commit || JSON.stringify(payload[8]) !== JSON.stringify(event.packet.welcome) || !await d.verifyPayload(committer, 'epoch', payload, event.packet.signature)) throw new Error('Invalid membership event proof');
        if (await this.isEncrypted(id)) await d.receiveCommit(id, event.packet.commit, committer.deviceId);
        else {
          if (!event.packet.added.includes(d.deviceId) || !event.packet.welcome) throw new Error('Missing device invitation');
          await d.join(id, committer.deviceId, event.packet.welcome);
          await this.publish();
        }
      }
      const state = await d.snapshot(id);
      if (Number(state.epoch) === response.epoch) return state;
      if (!response.events.length) throw new Error('Incomplete encryption history');
    }
    throw new Error('Encryption history exceeds synchronization limit');
  }
  async encrypt(id, clientMessageId, body) {
    if (this.purpose !== 'APP') throw new Error('Administrator devices cannot send chat messages');
    await this.sync(id);
    const directory = await this.directory(id);
    this.validateCandidates(directory);
    const state = await this.device.snapshot(id);
    // Validate the actual MLS tree, not just the server's membership metadata.
    const actual = state.devices.map(v => v.deviceId).sort();
    const expected = directory.devices.map(v => v.id).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected) || Number(state.epoch) !== directory.room?.epoch) throw new Error('Synchronize device membership before sending');
    const purposes = (await this.device.journal.load()).record.devicePurposes ?? {};
    if (!actual.some(id => purposes[id] === 'AUDIT')) throw new Error('No locally verified audit device');
    const envelope = await this.device.send(id, clientMessageId, body);
    return { envelope, signature: await this.device.signPayload('send', [this.device.userId, id, this.device.deviceId, clientMessageId, envelope.epoch, envelope.ciphertext]) };
  }
  async recoveryInfo() { return (await this.request(`${this.base}/recovery`, 'GET')).recovery; }
  async createRecovery() {
    const d = this.device;
    let { record, revision } = await d.journal.load();
    if (!record.recovery) {
      if (await this.recoveryInfo()) throw new Error('Enter the existing recovery code on this device');
      record.recovery = { id: this.uuid(), code: createRecoveryCode() };
      await d.journal.save(revision, record);
    }
    const recovery = record.recovery;
    const key = openRecoveryKey(recovery.code, d.userId, this.purpose);
    try {
      const payload = [d.userId, this.purpose, d.deviceId, recovery.id, key.publicKey];
      await this.request(`${this.base}/recovery/setup`, 'POST', { recoveryId: recovery.id, publicKey: key.publicKey, recoverySignature: key.sign('recovery-setup', payload), ...await this.signed('recovery-setup', payload) });
      return recovery.code;
    } finally { key.close(); }
  }
  async recover(code) {
    const d = this.device;
    const key = openRecoveryKey(code, d.userId, this.purpose);
    try {
      const recovery = await this.recoveryInfo();
      if (!recovery || recovery.publicKey !== key.publicKey) throw new Error('Recovery code does not match this account');
      const payload = [d.userId, this.purpose, recovery.id, d.deviceId, d.publicIdentity().publicKey];
      await this.request(`${this.base}/recovery/restore`, 'POST', { recoveryId: recovery.id, recoverySignature: key.sign('recover', payload), ...await this.signed('recover', payload) });
      const { record, revision } = await d.journal.load();
      record.recovery = { id: recovery.id, code };
      await d.journal.save(revision, record);
      await this.publish();
    } finally { key.close(); }
  }
  async resolveMessages(messages, reason) {
    const d = this.device;
    const refs = messages.map(m => ({ conversationId: m.conversationId, senderDeviceId: m.senderDeviceId, clientMessageId: m.clientMessageId }));
    const response = await this.request(`${this.base}/archive/resolve`, 'POST', { refs, ...(reason ? { reason } : {}), ...await this.signed('archive-resolve', [d.userId, this.purpose, d.deviceId, refs.map(ref => [ref.conversationId, ref.senderDeviceId, ref.clientMessageId]), reason ?? null]) });
    return response.items;
  }
  async archiveMessages(messages, reason, alreadyResolved) {
    const d = this.device;
    const recovery = (await d.journal.load()).record.recovery;
    if (!recovery) return 0;
    const key = openRecoveryKey(recovery.code, d.userId, this.purpose);
    try {
      const resolved = alreadyResolved ?? await this.resolveMessages(messages, reason);
      const items = [];
      let alreadyArchived = 0;
      for (const message of messages) {
        const ref = [message.conversationId, message.senderDeviceId, message.clientMessageId];
        const visible = resolved.find(v => JSON.stringify(v.ref) === JSON.stringify(ref));
        if (!visible) continue;
        if (visible.archived) { alreadyArchived++; continue; }
        if (visible.content.envelope.ciphertext !== message.ciphertext) throw new Error('Archive ciphertext conflict');
        const pin = d.pins.get(message.senderDeviceId);
        const e = visible.content.envelope;
        if (!pin || !await d.verifyPayload(pin, 'send', [pin.userId, e.conversationId, e.senderDeviceId, e.clientMessageId, e.epoch, e.ciphertext], visible.content.signature)) throw new Error('Invalid archive signature');
        items.push({ conversationId: ref[0], senderDeviceId: ref[1], clientMessageId: ref[2], ciphertext: key.seal(recovery.id, ref, { message, pin, signature: visible.content.signature }) });
      }
      if (!items.length) return alreadyArchived;
      let count = alreadyArchived;
      // At most two 48 KB ciphertexts keep each request below the server's
      // default 100 KiB JSON parser limit, including signatures and metadata.
      for (let offset = 0; offset < items.length; offset += 2) {
        const batch = items.slice(offset, offset + 2);
        const payload = [d.userId, this.purpose, d.deviceId, recovery.id, batch.map(v => [v.conversationId, v.senderDeviceId, v.clientMessageId, v.ciphertext]), reason ?? null];
        const result = await this.request(`${this.base}/archive/write`, 'POST', { recoverySignature: key.sign('archive-write', payload), recoveryId: recovery.id, items: batch, ...(reason ? { reason } : {}), ...await this.signed('archive-write', payload) });
        count += result.count;
      }
      return count;
    } finally { key.close(); }
  }
  async backupHistory(reason, onProgress) {
    if (!(await this.device.journal.load()).record.recovery) throw new Error('Set up recovery before archiving');
    let after = '', count = 0;
    for (;;) {
      const page = await this.device.messagePage(after, 20);
      if (!page.length) return count;
      count += await this.archiveMessages(page.map(v => v.value), reason);
      onProgress?.(count);
      after = page.at(-1).id;
    }
  }
  async restoreHistory(reason, onProgress) {
    const d = this.device;
    const recovery = (await d.journal.load()).record.recovery;
    if (!recovery) throw new Error('Enter recovery code first');
    const key = openRecoveryKey(recovery.code, d.userId, this.purpose);
    let after = '', count = 0;
    try {
      for (;;) {
        const response = await this.request(`${this.base}/archive/read`, 'POST', { recoveryId: recovery.id, after, ...(reason ? { reason } : {}), ...await this.signed('archive-read', [d.userId, this.purpose, d.deviceId, recovery.id, after, reason ?? null]) });
        for (const item of response.items) {
          const { message, pin, signature } = key.open(recovery.id, item.ref, item.ciphertext);
          const ref = [message.conversationId, message.senderDeviceId, message.clientMessageId];
          const e = item.content.envelope;
          if (JSON.stringify(ref) !== JSON.stringify(item.ref) || message.ciphertext !== e.ciphertext || pin.deviceId !== message.senderDeviceId || signature !== item.content.signature || !await d.verifyPayload(pin, 'send', [pin.userId, e.conversationId, e.senderDeviceId, e.clientMessageId, e.epoch, e.ciphertext], signature)) throw new Error('Invalid archived message');
          // This pin was authenticated inside the account's recovery ciphertext;
          // server directory data alone still cannot create a trusted identity.
          await d.confirmIdentity(pin);
          await d.importMessage(message);
          count++;
        }
        onProgress?.(count);
        if (!response.next) return count;
        if (response.next <= after) throw new Error('Invalid archive cursor');
        after = response.next;
      }
    } finally { key.close(); }
  }
  async decrypt(content, reason) {
    const e = content.envelope;
    const d = this.device;
    const readable = await this.resolveMessages([e], reason);
    if (readable.length !== 1 || readable[0].content.envelope.ciphertext !== e.ciphertext) throw new Error('Message is no longer available');
    const cached = await d.message(e);
    const current = await this.isEncrypted(e.conversationId) ? await d.snapshot(e.conversationId) : null;
    if (!cached && (!current || BigInt(e.epoch) > BigInt(current.epoch))) await this.sync(e.conversationId, reason);
    const pin = d.pins.get(e.senderDeviceId);
    if (!pin || !await d.verifyPayload(pin, 'send', [pin.userId, e.conversationId, e.senderDeviceId, e.clientMessageId, e.epoch, e.ciphertext], content.signature)) throw new Error('Invalid encrypted message signature');
    if (cached && cached.ciphertext !== e.ciphertext) throw new Error('Conflicting ciphertext for a known message');
    const body = cached ? cached.body : await d.receive(e);
    // The decrypted copy is durable locally before backup. A failed upload is
    // retried on the next read or explicit archive sweep, never regenerated MLS.
    if (!readable[0].archived) await this.archiveMessages([cached ?? await d.message(e)], reason, readable);
    return body;
  }
}
