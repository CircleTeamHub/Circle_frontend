// Offline physical-device acceptance entry. No network, JWTs or user accounts.
// Run with an embedded bundle over USB; it never enters the production router.
import { registerRootComponent } from 'expo';
import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';
import { ProtocolDevice } from '@circle/e2ee';
// @ts-ignore Shared portable implementation is JavaScript.
import { createRecoveryCode, openRecoveryKey } from '@circle/e2ee/recovery.mjs';
import { openDeviceJournal } from '../../src/services/e2ee/journal';

async function acceptance(progress: (step: string) => void) {
  const checks: string[] = [];
  const check = (ok: unknown, step: string) => { if (!ok) throw new Error(step); checks.push(step); progress(step); };
  const rejects = async (work: () => unknown, step: string) => { let failed = false; try { await work(); } catch { failed = true; } check(failed, step); };
  const prefix = 'acceptance-' + Crypto.randomUUID();
  const journals = [];
  let recoveryKey: ReturnType<typeof openRecoveryKey> | undefined;
  try {
    const users = [prefix + '-a', prefix + '-b', prefix + '-audit'];
    const devices = [];
    for (const user of users) { const journal = await openDeviceJournal(user); journals.push(journal); devices.push(await ProtocolDevice.open(journal, user, journal.deviceId, new Map())); }
    const [alice, bob, audit] = devices;
    for (const device of devices) for (const peer of devices) await device.confirmIdentity(peer.publicIdentity());
    const conversation = Crypto.randomUUID();
    await alice.create(conversation);
    const initial = await alice.changeMembers(conversation, Crypto.randomUUID(), { add: [await bob.publishKeyPackage(), await audit.publishKeyPackage()] });
    await bob.join(conversation, alice.deviceId, initial.welcome!);
    await audit.join(conversation, alice.deviceId, initial.welcome!);
    const body = { text: 'private-native-history-' + Crypto.randomUUID() };
    const oldEnvelope = await alice.send(conversation, Crypto.randomUUID(), body);
    check((await bob.receive(oldEnvelope)).text === body.text, 'native MLS encrypted text receive');
    check((await audit.receive(oldEnvelope)).text === body.text, 'authorized audit device decrypts text');
    const code = createRecoveryCode(); recoveryKey = openRecoveryKey(code, bob.userId, 'APP');
    const ref = [conversation, alice.deviceId, oldEnvelope.clientMessageId];
    const archive = recoveryKey.seal('offline-fixture', ref, await bob.message(oldEnvelope));
    check(!archive.includes(body.text), 'history archive contains ciphertext only');
    const wrong = openRecoveryKey(code, alice.userId, 'APP');
    await rejects(() => wrong.open('offline-fixture', ref, archive), 'recovery key is bound to account'); wrong.close();
    await rejects(() => recoveryKey!.open('other-archive', ref, archive), 'archive substitution is rejected');
    const oldPublic = bob.publicIdentity().publicKey;
    await journals[1].close();
    const restarted = await openDeviceJournal(bob.userId); journals.push(restarted);
    const reopened = await ProtocolDevice.open(restarted, bob.userId, restarted.deviceId, new Map());
    check(reopened.publicIdentity().publicKey === oldPublic, 'Keychain device key survives reopening');
    check((await reopened.message(oldEnvelope))!.body.text === body.text, 'SQLite encrypted archive survives reopening');
    const replacementJournal = await openDeviceJournal(bob.userId + '-replacement'); journals.push(replacementJournal);
    const replacement = await ProtocolDevice.open(replacementJournal, bob.userId, replacementJournal.deviceId, new Map());
    check(replacement.publicIdentity().publicKey !== oldPublic, 'replacement creates a fresh device signing key');
    await replacement.importMessage(recoveryKey!.open('offline-fixture', ref, archive));
    check((await replacement.message(oldEnvelope))!.body.text === body.text, 'new device restores pre-join history');
    check(Object.keys((await replacementJournal.load()).record!.groups).length === 0, 'history restoration never restores old sending ratchets');
    for (const peer of [alice, audit, replacement]) { await peer.confirmIdentity(replacement.publicIdentity()); for (const trusted of devices) await peer.confirmIdentity(trusted.publicIdentity()); }
    const changed = await alice.changeMembers(conversation, Crypto.randomUUID(), { add: [await replacement.publishKeyPackage()], remove: [bob.deviceId] });
    await replacement.join(conversation, alice.deviceId, changed.welcome!);
    await audit.receiveCommit(conversation, changed.commit);
    const current = await alice.send(conversation, Crypto.randomUUID(), { text: 'new epoch after device replacement' });
    check((await replacement.receive(current)).text === 'new epoch after device replacement', 'replacement joins fresh epoch and receives');
    await rejects(() => reopened.receive(current), 'revoked old device cannot decrypt fresh epoch');
    const reply = await replacement.send(conversation, Crypto.randomUUID(), { text: 'fresh device reply' });
    check((await alice.receive(reply)).text === 'fresh device reply', 'replacement sends encrypted text');
    for (let i = 0; i < 1050; i++) {
      const { record, revision } = await replacementJournal.load();
      record!.inbox['capacity-' + String(i).padStart(5, '0')] = { conversationId: conversation, senderDeviceId: alice.deviceId, clientMessageId: String(i), body: { text: 'archive-capacity-test' } };
      await replacementJournal.save(revision, record!);
    }
    check(Object.keys((await replacementJournal.load()).record!.inbox).length === 0, '1050 archived records do not grow hot journal');
    check((await replacementJournal.pageItems!('inbox', 'capacity-', 100)).length === 100, 'native archive uses bounded indexed pages');
    const before = await replacementJournal.load(); before.record!.inbox.fault = { conversationId: conversation, senderDeviceId: alice.deviceId, clientMessageId: 'fault', body: { text: 'not committed' } };
    await rejects(() => replacementJournal.save(before.revision, before.record!, () => { throw new Error('interruption'); }), 'interrupted ratchet/archive transaction rolls back');
    check(await replacementJournal.getItem!('inbox', 'fault') === undefined, 'failed archive write leaves no partial record');
    const raw = await SQLite.openDatabaseAsync(`e2ee-v1-${bob.userId}-replacement.sqlite`);
    const sample = await raw.getFirstAsync<{ sealed: Uint8Array }>('SELECT sealed FROM archive LIMIT 1');
    check(sample && !new TextDecoder().decode(sample.sealed).includes(body.text), 'SQLite stores sealed bytes'); await raw.closeAsync();
    return { ok: true, checks, platform: Platform.OS, os: Platform.Version, hermes: Boolean((globalThis as any).HermesInternal) };
  } catch (error) { return { ok: false, checks, error: error instanceof Error ? error.message : 'Unknown native failure' }; }
  finally { recoveryKey?.close(); for (const journal of journals) await journal.close(); }
}
function Acceptance() {
  const [steps, setSteps] = useState<string[]>([]);
  useEffect(() => { void acceptance(step => setSteps(old => [...old, 'PASS ' + step])).then(result => {
    new File(Paths.document, 'e2ee-device-result.json').write(JSON.stringify(result, null, 2));
    setSteps(old => [...old, result.ok ? 'DEVICE_ACCEPTANCE_OK' : 'FAILED ' + result.error]);
  }); }, []);
  return <ScrollView contentContainerStyle={{ padding: 30, paddingTop: 70 }}><Text style={{ fontSize: 24 }}>Circle 离线加密恢复验收</Text>{steps.map((step, i) => <Text key={i} style={{ marginTop: 12 }}>{step}</Text>)}</ScrollView>;
}
registerRootComponent(Acceptance);
