import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';
import {
  AvatarFrameResponseValidationError,
  fetchUserAppearances,
} from '@/services/api/avatar-frames';
import type { UserAppearance } from '@/types';

interface UserAppearanceState {
  appearances: Record<string, UserAppearance>;
  /** Compatibility projection used by existing userVipStore selectors. */
  levels: Record<string, number>;
  refreshTick: number;
}

export const useUserAppearanceStore = create<UserAppearanceState>(() => ({
  appearances: {},
  levels: {},
  refreshTick: 0,
}));

const BATCH_DELAY_MS = 60;
const MAX_IDS_PER_REQUEST = 200;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_FETCH_RETRIES = 3;
const RETRY_DELAY_MS = 3000;
const MOUNTED_SWEEP_MS = 60 * 1000;
const REAL_BACKGROUND_REFRESH_MS = 5 * 1000;
const VALIDATION_RETRY_COOLDOWN_MS = CACHE_TTL_MS;

const requested = new Set<string>();
const fetchedAt = new Map<string, number>();
const retryCount = new Map<string, number>();
const validationFailedAt = new Map<string, number>();
const retryTimers = new Set<ReturnType<typeof setTimeout>>();
const mountedCounts = new Map<string, number>();
const appearanceGenerations = new Map<string, number>();
const refreshAfterSettlement = new Set<string>();
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let mountedSweepTimer: ReturnType<typeof setTimeout> | null = null;
let batchGeneration = 0;
let appIsActive = true;
let backgroundedAt: number | null = null;
let lastForegroundAt = Date.now();

function isFresh(userId: string): boolean {
  const at = fetchedAt.get(userId);
  return at !== undefined && Date.now() - at < CACHE_TTL_MS;
}

function isValidationCoolingDown(userId: string): boolean {
  const failedAt = validationFailedAt.get(userId);
  if (failedAt === undefined) {
    return false;
  }
  if (Date.now() - failedAt < VALIDATION_RETRY_COOLDOWN_MS) {
    return true;
  }
  validationFailedAt.delete(userId);
  return false;
}

function cancelScheduledWork(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const timer of retryTimers) {
    clearTimeout(timer);
  }
  retryTimers.clear();
  pending = new Set();
  requested.clear();
  retryCount.clear();
  refreshAfterSettlement.clear();
}

function cancelMountedSweep(): void {
  if (mountedSweepTimer) {
    clearTimeout(mountedSweepTimer);
    mountedSweepTimer = null;
  }
}

function scheduleMountedSweep(): void {
  if (mountedSweepTimer || mountedCounts.size === 0) {
    return;
  }
  mountedSweepTimer = setTimeout(() => {
    mountedSweepTimer = null;
    if (appIsActive) {
      for (const userId of mountedCounts.keys()) {
        if (!isFresh(userId)) {
          requestUserAppearance(userId);
        }
      }
    }
    scheduleMountedSweep();
  }, MOUNTED_SWEEP_MS);
}

function retainMountedUser(userId: string): () => void {
  mountedCounts.set(userId, (mountedCounts.get(userId) ?? 0) + 1);
  scheduleMountedSweep();
  return () => {
    const nextCount = (mountedCounts.get(userId) ?? 1) - 1;
    if (nextCount > 0) {
      mountedCounts.set(userId, nextCount);
      return;
    }
    mountedCounts.delete(userId);
    if (mountedCounts.size === 0) {
      cancelMountedSweep();
    }
  };
}

function scheduleRetry(ids: string[]): void {
  const retriable = ids.filter(
    (id) => (retryCount.get(id) ?? 0) < MAX_FETCH_RETRIES,
  );
  if (retriable.length === 0) {
    return;
  }
  for (const id of retriable) {
    retryCount.set(id, (retryCount.get(id) ?? 0) + 1);
  }
  const timer = setTimeout(() => {
    retryTimers.delete(timer);
    for (const id of retriable) {
      requestUserAppearance(id);
    }
  }, RETRY_DELAY_MS);
  retryTimers.add(timer);
}

function applyAuthoritativeResult(
  ids: string[],
  result: Record<string, UserAppearance>,
): void {
  const now = Date.now();
  for (const id of ids) {
    requested.delete(id);
    fetchedAt.set(id, now);
    retryCount.delete(id);
    validationFailedAt.delete(id);
  }
  useUserAppearanceStore.setState((state) => {
    const appearances = { ...state.appearances };
    const levels = { ...state.levels };
    let changed = false;
    for (const id of ids) {
      const appearance = Object.prototype.hasOwnProperty.call(result, id)
        ? result[id]
        : { vipLevel: 0, avatarFrame: null };
      const current = state.appearances[id];
      const currentFrame = current?.avatarFrame;
      const nextFrame = appearance.avatarFrame;
      const sameFrame =
        currentFrame === nextFrame ||
        (currentFrame !== null &&
          typeof currentFrame !== 'undefined' &&
          nextFrame !== null &&
          currentFrame.id === nextFrame.id &&
          currentFrame.key === nextFrame.key &&
          currentFrame.name === nextFrame.name &&
          currentFrame.imageUrl === nextFrame.imageUrl);
      if (
        !current ||
        current.vipLevel !== appearance.vipLevel ||
        !sameFrame ||
        state.levels[id] !== appearance.vipLevel
      ) {
        appearances[id] = appearance;
        levels[id] = appearance.vipLevel;
        changed = true;
      }
    }
    return changed ? { appearances, levels } : state;
  });
}

function requestQueuedForegroundRefresh(ids: string[]): void {
  for (const id of ids) {
    requested.delete(id);
    retryCount.delete(id);
    validationFailedAt.delete(id);
    fetchedAt.delete(id);
    requestUserAppearance(id);
  }
}

async function flush(): Promise<void> {
  const startGeneration = batchGeneration;
  const ids = [...pending];
  const startAppearanceGenerations = new Map(
    ids.map((id) => [id, appearanceGenerations.get(id) ?? 0]),
  );
  pending = new Set();

  for (let index = 0; index < ids.length; index += MAX_IDS_PER_REQUEST) {
    const chunk = ids.slice(index, index + MAX_IDS_PER_REQUEST);
    try {
      const result = await fetchUserAppearances(chunk);
      if (batchGeneration !== startGeneration) {
        return;
      }
      const currentIds = chunk.filter(
        (id) =>
          (appearanceGenerations.get(id) ?? 0) ===
          startAppearanceGenerations.get(id),
      );
      const queuedIds = currentIds.filter((id) =>
        refreshAfterSettlement.delete(id),
      );
      const authoritativeIds = currentIds.filter(
        (id) => !queuedIds.includes(id),
      );
      applyAuthoritativeResult(authoritativeIds, result);
      requestQueuedForegroundRefresh(queuedIds);
    } catch (error) {
      if (batchGeneration !== startGeneration) {
        return;
      }
      const currentIds = chunk.filter(
        (id) =>
          (appearanceGenerations.get(id) ?? 0) ===
          startAppearanceGenerations.get(id),
      );
      const queuedIds = currentIds.filter((id) =>
        refreshAfterSettlement.delete(id),
      );
      const failedIds = currentIds.filter((id) => !queuedIds.includes(id));
      for (const id of currentIds) {
        requested.delete(id);
      }
      requestQueuedForegroundRefresh(queuedIds);
      if (error instanceof AvatarFrameResponseValidationError) {
        const failedAt = Date.now();
        for (const id of failedIds) {
          validationFailedAt.set(id, failedAt);
        }
      } else {
        scheduleRetry(failedIds);
      }
    }
  }
}

function scheduleFlush(): void {
  if (pending.size >= MAX_IDS_PER_REQUEST) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flush();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, BATCH_DELAY_MS);
  }
}

export function requestUserAppearance(userId: string): void {
  const normalizedId = userId.trim();
  if (
    !normalizedId ||
    isValidationCoolingDown(normalizedId) ||
    isFresh(normalizedId) ||
    requested.has(normalizedId)
  ) {
    return;
  }
  requested.add(normalizedId);
  pending.add(normalizedId);
  scheduleFlush();
}

export function reconcileUserAppearance(
  userId: string,
  appearance: UserAppearance,
): void {
  const normalizedId = userId.trim();
  if (!normalizedId) {
    return;
  }

  appearanceGenerations.set(
    normalizedId,
    (appearanceGenerations.get(normalizedId) ?? 0) + 1,
  );
  pending.delete(normalizedId);
  requested.delete(normalizedId);
  retryCount.delete(normalizedId);
  validationFailedAt.delete(normalizedId);
  refreshAfterSettlement.delete(normalizedId);
  fetchedAt.set(normalizedId, Date.now());
  useUserAppearanceStore.setState((state) => ({
    appearances: {
      ...state.appearances,
      [normalizedId]: appearance,
    },
    levels: {
      ...state.levels,
      [normalizedId]: appearance.vipLevel,
    },
  }));
}

export function invalidateUserAppearances(): void {
  batchGeneration += 1;
  cancelScheduledWork();
  cancelMountedSweep();
  mountedCounts.clear();
  appearanceGenerations.clear();
  validationFailedAt.clear();
  fetchedAt.clear();
  useUserAppearanceStore.setState((state) => ({
    appearances: {},
    levels: {},
    refreshTick: state.refreshTick + 1,
  }));
}

AppState.addEventListener('change', (status) => {
  if (status !== 'active') {
    if (appIsActive) {
      backgroundedAt = Date.now();
    }
    appIsActive = false;
    return;
  }
  const now = Date.now();
  const awayDuration = appIsActive
    ? 0
    : Math.max(0, now - (backgroundedAt ?? lastForegroundAt));
  backgroundedAt = null;
  lastForegroundAt = now;
  appIsActive = true;
  if (awayDuration < REAL_BACKGROUND_REFRESH_MS) {
    return;
  }
  for (const userId of mountedCounts.keys()) {
    fetchedAt.delete(userId);
    if (requested.has(userId)) {
      refreshAfterSettlement.add(userId);
      continue;
    }
    requestUserAppearance(userId);
  }
  scheduleMountedSweep();
});

export function useRequestUserAppearance(userId?: string | null): void {
  const refreshTick = useUserAppearanceStore((state) => state.refreshTick);
  useEffect(() => {
    const normalizedId = userId?.trim();
    if (!normalizedId) {
      return;
    }
    const release = retainMountedUser(normalizedId);
    requestUserAppearance(normalizedId);
    return release;
  }, [userId, refreshTick]);
}

export function useUserAppearance(
  userId?: string | null,
): UserAppearance | undefined {
  const normalizedId = userId?.trim();
  const appearance = useUserAppearanceStore((state) =>
    normalizedId ? state.appearances[normalizedId] : undefined,
  );
  useRequestUserAppearance(normalizedId);
  return appearance;
}
