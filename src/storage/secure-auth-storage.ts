import type * as SecureStoreModule from 'expo-secure-store';
import type { StateStorage } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';
import { getSecureKv, type SecureKvApi } from '@/storage/secure-kv';
import { sanitizeUserForPersist } from '@/stores/persisted-user';
import { reportHandledFailure } from '@/observability/report-failure';
import { devWarn } from '@/utils/dev-log';

type SecureStoreApi = SecureKvApi;
type SecureStoreOptions = SecureStoreModule.SecureStoreOptions;

// 平台间接层（secure-kv）：原生仍是懒加载的 expo-secure-store，Web 换成
// localStorage 档 —— 本文件其余逻辑（降级读、互斥队列、多账号 token）
// 两端共用，不随平台分叉。
const getSecureStore = getSecureKv;

function secureStoreOptions(secureStore: SecureStoreApi): SecureStoreOptions {
  return {
    // AFTER_FIRST_UNLOCK：首次解锁后（含之后再次锁屏）后台仍可读 token。
    // IM app 会被静默推送 / 后台任务在锁屏下唤醒，WHEN_UNLOCKED 会让这些读取直接抛错，
    // 进而触发下面的 degraded / 强制登出路径。
    keychainAccessible: secureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  };
}

const AUTH_KEY = 'circle-im-auth';
const KNOWN_ACCOUNTS_KEY = 'circle-im-known-accounts';

// hydration「读」失败（锁屏 / Keychain 抖动 / 冷启动早期不可用）时置位。
// 此刻 store 还是空的初始态，绝不能让随后写回的空态把磁盘上完好的凭证清掉。
// 一旦某次读成功、或写入带来真实 token，即解除降级、恢复正常删除语义。
let authReadDegraded = false;
let knownAccountsReadDegraded = false;
const explicitlyRemovedKnownAccountIds = new Set<string>();
let authMutationQueue: Promise<void> = Promise.resolve();

function enqueueAuthMutation(action: () => Promise<void>): Promise<void> {
  const next = authMutationQueue.then(action, action);
  authMutationQueue = next.catch(() => {});
  return next;
}

interface PersistEnvelope {
  state?: Record<string, unknown>;
  version?: unknown;
  [key: string]: unknown;
}

interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  imToken: string | null;
}

function legacyTokenBundleKey(key: string) {
  return `${key}.tokens`;
}

function tokenFieldKey(key: string, field: keyof TokenBundle) {
  return `${key}.${field}`;
}

function secureStoreKeyComponent(value: string) {
  return Array.from(value)
    .map((char) => {
      if (/^[A-Za-z0-9._-]$/.test(char)) return char;
      return `_${char.codePointAt(0)?.toString(16) ?? '0'}_`;
    })
    .join('');
}

function knownAccountTokenPrefix(userId: string) {
  return `${KNOWN_ACCOUNTS_KEY}.${secureStoreKeyComponent(userId)}`;
}

export function markKnownAccountRemoved(userId: string) {
  explicitlyRemovedKnownAccountIds.add(userId);
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asEnvelope(value: unknown): PersistEnvelope | null {
  return isRecord(value) ? (value as PersistEnvelope) : null;
}

function extractTokenBundle(value: unknown): TokenBundle | null {
  if (!isRecord(value)) return null;
  const { accessToken, refreshToken, imToken } = value;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    return null;
  }
  return {
    accessToken,
    refreshToken,
    imToken: typeof imToken === 'string' ? imToken : null,
  };
}

function stripTokenFields<T extends Record<string, unknown>>(value: T): T {
  const { accessToken, refreshToken, imToken, ...rest } = value;
  void accessToken;
  void refreshToken;
  void imToken;
  return rest as T;
}

function envelopeWithState(
  envelope: PersistEnvelope | null,
  state: Record<string, unknown>,
): PersistEnvelope {
  return {
    ...(envelope ?? {}),
    state,
  };
}

function hasMeaningfulMetadata(envelope: PersistEnvelope): boolean {
  if (envelope.version !== undefined) return true;
  return isRecord(envelope.state) && Object.keys(envelope.state).length > 0;
}

async function getLegacyItem(key: string): Promise<string | null> {
  return await mmkvJsonStorage.getItem(key);
}

async function setLegacyItem(key: string, value: string): Promise<void> {
  await mmkvJsonStorage.setItem(key, value);
}

async function removeLegacyItem(key: string): Promise<void> {
  await mmkvJsonStorage.removeItem(key);
}

async function writeMetadataOrRemove(key: string, envelope: PersistEnvelope) {
  if (hasMeaningfulMetadata(envelope)) {
    await setLegacyItem(key, JSON.stringify(envelope));
  } else {
    await removeLegacyItem(key);
  }
}

async function bestEffortLegacyCleanup(action: () => void | Promise<void>) {
  try {
    await action();
  } catch (err) {
    reportHandledFailure('secureStorage', 'legacyCleanup', err);
  }
}

async function readTokenBundle(key: string): Promise<TokenBundle | null> {
  const secureStore = await getSecureStore();
  // 三个字段相互独立，并行读以缩短启动 hydration 路径上的 Keychain 延迟
  // （多账号时 readTokenBundle 会被调用 N 次，串行累加会明显拖慢冷启动）。
  const [accessToken, refreshToken, imToken] = await Promise.all([
    secureStore.getItemAsync(tokenFieldKey(key, 'accessToken')),
    secureStore.getItemAsync(tokenFieldKey(key, 'refreshToken')),
    secureStore.getItemAsync(tokenFieldKey(key, 'imToken')),
  ]);
  if (typeof accessToken === 'string' && typeof refreshToken === 'string') {
    return { accessToken, refreshToken, imToken: imToken ?? null };
  }

  const legacyBundle = extractTokenBundle(
    parseJson(await secureStore.getItemAsync(legacyTokenBundleKey(key))),
  );
  if (legacyBundle) {
    await writeTokenBundle(key, legacyBundle);
  }
  return legacyBundle;
}

async function writeTokenBundle(key: string, tokens: TokenBundle | null) {
  const secureStore = await getSecureStore();
  if (tokens) {
    await secureStore.setItemAsync(
      tokenFieldKey(key, 'accessToken'),
      tokens.accessToken,
      secureStoreOptions(secureStore),
    );
    await secureStore.setItemAsync(
      tokenFieldKey(key, 'refreshToken'),
      tokens.refreshToken,
      secureStoreOptions(secureStore),
    );
    if (tokens.imToken) {
      await secureStore.setItemAsync(
        tokenFieldKey(key, 'imToken'),
        tokens.imToken,
        secureStoreOptions(secureStore),
      );
    } else {
      await secureStore.deleteItemAsync(tokenFieldKey(key, 'imToken'));
    }
  } else {
    await secureStore.deleteItemAsync(tokenFieldKey(key, 'accessToken'));
    await secureStore.deleteItemAsync(tokenFieldKey(key, 'refreshToken'));
    await secureStore.deleteItemAsync(tokenFieldKey(key, 'imToken'));
  }
  await secureStore.deleteItemAsync(legacyTokenBundleKey(key));
}

function sanitizeAuthEnvelope(envelope: PersistEnvelope | null): PersistEnvelope {
  const state = isRecord(envelope?.state) ? stripTokenFields(envelope.state) : {};
  return envelopeWithState(envelope, {
    ...state,
    ...(isRecord(state.user)
      ? { user: sanitizeUserForPersist(state.user) }
      : {}),
  });
}

async function loadAuthItem(key: string): Promise<string | null> {
  const metadataValue = await getLegacyItem(key);
  const envelope = asEnvelope(parseJson(metadataValue));
  let tokens = await readTokenBundle(key);

  const state = isRecord(envelope?.state) ? envelope.state : {};
  const legacyTokens = extractTokenBundle(state);
  if (!tokens && legacyTokens) {
    await writeTokenBundle(key, legacyTokens);
    tokens = legacyTokens;
  }

  const sanitized = sanitizeAuthEnvelope(envelope);
  if (metadataValue !== null) {
    await bestEffortLegacyCleanup(() => writeMetadataOrRemove(key, sanitized));
  }

  if (!tokens && !hasMeaningfulMetadata(sanitized)) {
    return null;
  }

  return JSON.stringify(
    envelopeWithState(sanitized, {
      ...(isRecord(sanitized.state) ? sanitized.state : {}),
      ...(tokens ?? {}),
    }),
  );
}

async function getAuthItem(key: string): Promise<string | null> {
  try {
    const result = await loadAuthItem(key);
    authReadDegraded = false;
    return result;
  } catch (err) {
    // 读失败：标记降级并向 persist 抛出（触发 onRehydrateStorage 的 error 分支）。
    // 磁盘凭证保持不动，等下次启动重新 hydration 时恢复。
    authReadDegraded = true;
    reportHandledFailure('secureStorage', 'authReadDegraded', err);
    throw err;
  }
}

async function setAuthItem(key: string, value: string): Promise<void> {
  const envelope = asEnvelope(parseJson(value));
  const state = isRecord(envelope?.state) ? envelope.state : {};
  const tokens = extractTokenBundle(state);

  // 降级期间写回的空态来自「读失败后的初始内存」，不是真实登出——直接忽略，
  // 保留磁盘上完好的 token 与 metadata。真实登出走 removeItem，不受此影响。
  if (!tokens && authReadDegraded) {
    devWarn('[secure-auth-storage] auth degraded: ignore empty write to preserve stored session');
    return;
  }
  // 拿到真实 token 说明存储已恢复正常，解除降级。
  if (tokens) authReadDegraded = false;

  await writeTokenBundle(key, tokens);
  await writeMetadataOrRemove(key, sanitizeAuthEnvelope(envelope));
}

function getAccountUserId(account: unknown): string | null {
  if (!isRecord(account) || !isRecord(account.user)) return null;
  return typeof account.user.id === 'string' ? account.user.id : null;
}

function sanitizeKnownAccount(account: Record<string, unknown>) {
  const sanitized = stripTokenFields(account);
  return {
    ...sanitized,
    ...(isRecord(sanitized.user)
      ? { user: sanitizeUserForPersist(sanitized.user) }
      : {}),
  };
}

function getKnownAccounts(envelope: PersistEnvelope | null): Record<string, unknown>[] {
  const state = isRecord(envelope?.state) ? envelope.state : {};
  return Array.isArray(state.accounts)
    ? state.accounts.filter(isRecord)
    : [];
}

/** 以 userId 为键合并：overrides 覆盖同 id，base 中未被覆盖的账号保留在后。 */
function mergeAccountsById(
  base: Record<string, unknown>[],
  overrides: Record<string, unknown>[],
): Record<string, unknown>[] {
  const overrideIds = new Set(
    overrides
      .map(getAccountUserId)
      .filter((userId): userId is string => typeof userId === 'string'),
  );
  const preserved = base.filter((account) => {
    const userId = getAccountUserId(account);
    return userId !== null && !overrideIds.has(userId);
  });
  return [...overrides, ...preserved];
}

function knownAccountsEnvelope(
  envelope: PersistEnvelope | null,
  accounts: Record<string, unknown>[],
): PersistEnvelope {
  const state = isRecord(envelope?.state) ? stripTokenFields(envelope.state) : {};
  return envelopeWithState(envelope, {
    ...state,
    accounts,
  });
}

async function readKnownAccountTokens(userId: string): Promise<TokenBundle | null> {
  return readTokenBundle(knownAccountTokenPrefix(userId));
}

async function writeKnownAccountTokens(userId: string, tokens: TokenBundle | null) {
  await writeTokenBundle(knownAccountTokenPrefix(userId), tokens);
}

async function loadKnownAccountsItem(key: string): Promise<string | null> {
  const metadataValue = await getLegacyItem(key);
  const envelope = asEnvelope(parseJson(metadataValue));
  const accounts = getKnownAccounts(envelope);
  if (!envelope && accounts.length === 0) return null;

  const reconstructedAccounts: Record<string, unknown>[] = [];
  let hadLegacyTokens = false;

  for (const account of accounts) {
    const userId = getAccountUserId(account);
    if (!userId) continue;

    let tokens = await readKnownAccountTokens(userId);
    const legacyTokens = extractTokenBundle(account);
    if (!tokens && legacyTokens) {
      await writeKnownAccountTokens(userId, legacyTokens);
      tokens = legacyTokens;
      hadLegacyTokens = true;
    }
    if (!tokens) continue;

    reconstructedAccounts.push({
      ...sanitizeKnownAccount(account),
      ...tokens,
    });
  }

  const sanitizedEnvelope = knownAccountsEnvelope(
    envelope,
    accounts.map(sanitizeKnownAccount),
  );
  if (hadLegacyTokens || metadataValue !== null) {
    await bestEffortLegacyCleanup(() =>
      writeMetadataOrRemove(key, sanitizedEnvelope),
    );
  }

  return JSON.stringify(
    knownAccountsEnvelope(envelope, reconstructedAccounts),
  );
}

async function getKnownAccountsItem(key: string): Promise<string | null> {
  try {
    const result = await loadKnownAccountsItem(key);
    knownAccountsReadDegraded = false;
    return result;
  } catch (err) {
    knownAccountsReadDegraded = true;
    reportHandledFailure('secureStorage', 'knownAccountsReadDegraded', err);
    throw err;
  }
}

async function setKnownAccountsItem(key: string, value: string): Promise<void> {
  const nextEnvelope = asEnvelope(parseJson(value));
  const nextAccounts = getKnownAccounts(nextEnvelope);
  const previousEnvelope = asEnvelope(parseJson(await getLegacyItem(key)));
  const previousAccounts = getKnownAccounts(previousEnvelope);
  const explicitlyRemovedIds = new Set(explicitlyRemovedKnownAccountIds);
  explicitlyRemovedKnownAccountIds.clear();
  const previousUserIds = new Set(
    previousAccounts
      .map(getAccountUserId)
      .filter((userId): userId is string => typeof userId === 'string'),
  );
  const nextUserIds = new Set<string>();

  for (const account of nextAccounts) {
    const userId = getAccountUserId(account);
    if (!userId) continue;
    nextUserIds.add(userId);
    await writeKnownAccountTokens(userId, extractTokenBundle(account));
  }

  if (knownAccountsReadDegraded) {
    // hydration 读失败后内存账号列表不完整：只做增量 upsert，绝不把「未出现」
    // 当成移除去删 token；并把本次变更合并进既有 metadata，避免把读不到的账号
    // （及其 Keychain 凭证）从列表里弄丢。显式 removeAccount 例外：用户主动删除
    // 的账号必须立即清凭证，避免退出登录后又被 merge 回账号切换器。
    devWarn('[secure-auth-storage] known-accounts degraded: merge-only, skip token pruning');
    for (const userId of explicitlyRemovedIds) {
      await writeKnownAccountTokens(userId, null);
    }
    const keepAccount = (account: Record<string, unknown>) => {
      const userId = getAccountUserId(account);
      return userId === null || !explicitlyRemovedIds.has(userId);
    };
    await writeMetadataOrRemove(
      key,
      knownAccountsEnvelope(
        nextEnvelope,
        mergeAccountsById(
          previousAccounts.filter(keepAccount),
          nextAccounts.filter(keepAccount),
        ).map(sanitizeKnownAccount),
      ),
    );
    return;
  }

  for (const userId of previousUserIds) {
    if (!nextUserIds.has(userId)) {
      await writeKnownAccountTokens(userId, null);
    }
  }

  await writeMetadataOrRemove(
    key,
    knownAccountsEnvelope(nextEnvelope, nextAccounts.map(sanitizeKnownAccount)),
  );
}

async function removeKnownAccountsItem(key: string): Promise<void> {
  const envelope = asEnvelope(parseJson(await getLegacyItem(key)));
  for (const account of getKnownAccounts(envelope)) {
    const userId = getAccountUserId(account);
    if (userId) {
      await writeKnownAccountTokens(userId, null);
    }
  }
  await removeLegacyItem(key);
}

/**
 * Zustand storage for auth credentials.
 *
 * SecureStore stores only small token payloads. Non-secret auth metadata stays
 * in MMKV with token fields stripped so SecureStore size limits cannot break
 * normal profile or multi-account persistence.
 */
export const secureAuthStorage: StateStorage = {
  getItem: async (key) => {
    if (key === AUTH_KEY) return getAuthItem(key);
    if (key === KNOWN_ACCOUNTS_KEY) return getKnownAccountsItem(key);

    const secureStore = await getSecureStore();
    const secureValue = await secureStore.getItemAsync(legacyTokenBundleKey(key));
    if (secureValue !== null) {
      await bestEffortLegacyCleanup(() => removeLegacyItem(key));
      return secureValue;
    }

    const legacyValue = await getLegacyItem(key);
    if (legacyValue === null) return null;
    await secureStore.setItemAsync(
      legacyTokenBundleKey(key),
      legacyValue,
      secureStoreOptions(secureStore),
    );
    await bestEffortLegacyCleanup(() => removeLegacyItem(key));
    return legacyValue;
  },
  setItem: async (key, value) => {
    if (key === AUTH_KEY) {
      await enqueueAuthMutation(() => setAuthItem(key, value));
      return;
    }
    if (key === KNOWN_ACCOUNTS_KEY) {
      await setKnownAccountsItem(key, value);
      return;
    }

    const secureStore = await getSecureStore();
    await secureStore.setItemAsync(
      legacyTokenBundleKey(key),
      value,
      secureStoreOptions(secureStore),
    );
    await bestEffortLegacyCleanup(() => removeLegacyItem(key));
  },
  removeItem: async (key) => {
    if (key === KNOWN_ACCOUNTS_KEY) {
      await removeKnownAccountsItem(key);
      return;
    }
    if (key === AUTH_KEY) {
      await enqueueAuthMutation(async () => {
        await writeTokenBundle(key, null);
        await removeLegacyItem(key);
      });
      return;
    }

    const secureStore = await getSecureStore();
    await secureStore.deleteItemAsync(legacyTokenBundleKey(key));
    await removeLegacyItem(key);
  },
};
