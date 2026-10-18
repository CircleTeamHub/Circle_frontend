import { ProtocolDevice } from '@circle/e2ee';
import { EncryptionClient, type EncryptedContent } from '@circle/e2ee/relay-client.mjs';
import * as Crypto from 'expo-crypto';
import { apiClient } from '@/services/api/client';
import { registerLogoutHandler } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { openDeviceJournal, prepareReplacementJournal, type DeviceJournal } from './journal';

let active: { epoch: number; promise: Promise<EncryptionClient>; journal?: DeviceJournal } | undefined;
export function encryptionEnabled() { return process.env.EXPO_PUBLIC_E2EE_TEXT_ENABLED === 'true'; }
export function getEncryptionClient(): Promise<EncryptionClient> {
  const { user, sessionEpoch } = useAuthStore.getState();
  if (!user) return Promise.reject(new Error('Sign in before using encrypted chat'));
  if (active?.epoch === sessionEpoch) return active.promise;
  const entry: NonNullable<typeof active> = { epoch: sessionEpoch, promise: Promise.resolve(null as unknown as EncryptionClient) };
  const assertSession = () => {
    const state = useAuthStore.getState();
    if (state.user?.id !== user.id || state.sessionEpoch !== sessionEpoch) throw new Error('Encryption session changed');
  };
  entry.promise = (async () => {
    const journal = await openDeviceJournal(user.id);
    entry.journal = journal;
    try {
      assertSession();
      const device = await ProtocolDevice.open(journal, user.id, journal.deviceId, new Map());
      assertSession();
      return new EncryptionClient(device, async (path, method, body) => {
        assertSession();
        const result = await apiClient(path, { method, ...(body === undefined ? {} : { body }) });
        assertSession();
        return result;
      }, Crypto.randomUUID);
    } catch (error) { await journal.close(); throw error; }
  })().catch((error: unknown) => { if (active === entry) active = undefined; throw error; });
  active = entry;
  return entry.promise;
}
registerLogoutHandler(async () => {
  const previous = active; active = undefined;
  await previous?.promise.catch(() => undefined);
  await previous?.journal?.close();
});

export async function encryptOutgoingText(conversationId: string, id: string, content: Record<string, unknown>, knownEncrypted: boolean) {
  if (!encryptionEnabled() && !knownEncrypted) return null;
  const client = await getEncryptionClient();
  return client.run(async () => {
    const directory = await client.directory(conversationId);
    if (directory.mode !== 'MLS_V1' && !await client.isEncrypted(conversationId)) return null;
    return client.encrypt(conversationId, id, content);
  });
}
export async function decryptText(content: EncryptedContent) {
  const client = await getEncryptionClient();
  return client.run(() => client.decrypt(content));
}

export async function recoverMissingLocalKey() {
  const { user } = useAuthStore.getState();
  if (!user) throw new Error('Sign in before recovering encryption');
  const previous = active; active = undefined;
  await previous?.promise.catch(() => undefined);
  await previous?.journal?.close();
  await prepareReplacementJournal(user.id);
}
