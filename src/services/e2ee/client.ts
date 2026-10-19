import { reportHandledFailure } from '@/observability/report-failure';
import { onEncryptedBodyPurge, purgeEncryptedBody } from './lifecycle';
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
      await device.purgeMessages(value => Boolean((value as unknown as {expiresAt?: string}).expiresAt && Date.parse((value as unknown as {expiresAt: string}).expiresAt) <= Date.now()));
      for (let after = ''; ;) {
        const page = await device.messagePage(after, 100);
        for (const item of page) scheduleBodyExpiry(item.value.expiresAt);
        if (page.length < 100) break;
        after = page[page.length - 1].id;
      }
      return new EncryptionClient(device, async (path, method, body) => {
        assertSession();
        const result = await apiClient(path, { method, ...(body === undefined ? {} : { body }) });
        assertSession();
        if (path.endsWith('/archive/read')) {
          for (const item of (result as {items?: {expiresAt?: string}[]}).items ?? []) scheduleBodyExpiry(item.expiresAt);
        }
        return result;
      }, Crypto.randomUUID);
    } catch (error) { await journal.close(); throw error; }
  })().catch((error: unknown) => { if (active === entry) active = undefined; throw error; });
  active = entry;
  return entry.promise;
}
registerLogoutHandler(async () => {
  if (bodyExpiryTimer) clearTimeout(bodyExpiryTimer);
  bodyExpiries.clear();
  const previous = active; active = undefined;
  await previous?.promise.catch(() => undefined);
  await previous?.journal?.close();
});

export async function encryptOutgoingText(conversationId: string, id: string, content: Record<string, unknown>, knownEncrypted: boolean) {
  if (!encryptionEnabled() && !knownEncrypted) return null;
  const client = await getEncryptionClient();
  return client.run(async () => {
    const directory = await client.directory(conversationId);
    // An unconfirmed local group may remain after a timed-out enable request.
    // The server mode decides whether new text is encrypted; never downgrade a known encrypted conversation.
    if (directory.mode !== 'MLS_V1') {
      if (knownEncrypted) throw new Error('Encrypted conversation is not available');
      return null;
    }
    return client.encrypt(conversationId, id, content);
  });
}
type DecryptRequest = { content: EncryptedContent; epoch: number; pendingOwn: boolean; resolve: (body: Record<string, unknown>) => void; reject: (error: unknown) => void };
let pendingDecryptions: DecryptRequest[] = [];
const bodyExpiries = new Set<number>();
let bodyExpiryTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleBodyExpiry(expiresAt: string | null | undefined) {
  const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
  if (Number.isFinite(expiry)) bodyExpiries.add(expiry);
  if (bodyExpiryTimer) clearTimeout(bodyExpiryTimer);
  for (const at of bodyExpiries) if (at <= Date.now()) bodyExpiries.delete(at);
  if (!bodyExpiries.size) return;
  bodyExpiryTimer = setTimeout(() => { purgeEncryptedBody({expired: true}); scheduleBodyExpiry(null); }, Math.min(60_000, Math.max(1, Math.min(...bodyExpiries) - Date.now() + 1)));
}

export function decryptText(content: EncryptedContent, pendingOwn = false): Promise<Record<string, unknown>> {
  const e = content?.envelope;
  if (!e || typeof e !== 'object' || ['conversationId','senderDeviceId','clientMessageId','ciphertext'].some(key => typeof e[key as keyof typeof e] !== 'string' || !e[key as keyof typeof e]) || typeof content.signature !== 'string' || !content.signature) return Promise.reject(new Error('Invalid encrypted message'));
  return new Promise((resolve, reject) => {
    pendingDecryptions.push({ content, pendingOwn, epoch: useAuthStore.getState().sessionEpoch, resolve, reject });
    if (pendingDecryptions.length === 1) setTimeout(() => { void flushDecryptions(); }, 0);
  });
}
async function flushDecryptions() {
  const pending = pendingDecryptions; pendingDecryptions = [];
  try {
    const client = await getEncryptionClient();
    for (let offset = 0; offset < pending.length; offset += 20) {
      const batch = pending.slice(offset, offset + 20);
      await client.run(async () => {
        const remote: DecryptRequest[] = [];
        for (const item of batch) {
          if (item.epoch !== useAuthStore.getState().sessionEpoch) { item.reject(new Error('Encryption session changed')); continue; }
          const e = item.content.envelope;
          if (item.pendingOwn && e.senderDeviceId === client.device.deviceId) {
            const cached = await client.device.message(e);
            if (cached?.ciphertext === e.ciphertext) { item.resolve(cached.body); continue; }
          }
          remote.push(item);
        }
        if (!remote.length) return;
        const readable = await client.resolveMessages(remote.map(item => item.content.envelope));
        for (const item of remote) {
          const e = item.content.envelope;
          const matches = readable.filter(row => row.ref.conversationId === e.conversationId && row.ref.senderDeviceId === e.senderDeviceId && row.ref.clientMessageId === e.clientMessageId);
          try { const body = await client.decrypt(item.content, undefined, matches); scheduleBodyExpiry(matches[0]?.expiresAt); item.resolve(body); } catch (error) { item.reject(error); }
        }
      });
    }
  } catch (error) { for (const item of pending) item.reject(error); }
}
onEncryptedBodyPurge(({conversationId, clientMessageId, serverMessageId, expired}) => {
  const promise = active?.promise ?? (conversationId ? getEncryptionClient() : undefined);
  if (!promise) return;
  void promise.then(client => client.run(() => client.device.purgeMessages(value => {
    const metadata = value as unknown as {serverMessageId?: string; expiresAt?: string};
    return expired ? Boolean(metadata.expiresAt && Date.parse(metadata.expiresAt) <= Date.now())
      : value.conversationId === conversationId && (!serverMessageId || metadata.serverMessageId === serverMessageId) && (!clientMessageId || value.clientMessageId === clientMessageId);
  }))).catch(() => { reportHandledFailure('e2ee', 'purgeBodies', new Error('Encrypted body purge failed')); });
});

export async function recoverMissingLocalKey() {
  const { user } = useAuthStore.getState();
  if (!user) throw new Error('Sign in before recovering encryption');
  const previous = active; active = undefined;
  await previous?.promise.catch(() => undefined);
  await previous?.journal?.close();
  await prepareReplacementJournal(user.id);
}
