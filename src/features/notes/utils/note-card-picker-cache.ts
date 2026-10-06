import type { FriendProfile } from '@/services/api/friends';
import type { MyCircle } from '@/types';

const NOTE_CARD_PICKER_CACHE_TTL_MS = 5 * 60 * 1000;

export type NoteCardPickerCircle = Pick<MyCircle, 'id' | 'name' | 'avatarUrl'>;

type CacheEntry<T> = {
  accountId: string;
  value: T[];
  updatedAt: number;
};

let friendsCache: CacheEntry<FriendProfile> | null = null;
let circlesCache: CacheEntry<NoteCardPickerCircle> | null = null;
let friendsInFlight: { accountId: string; promise: Promise<FriendProfile[]> } | null = null;
let circlesInFlight: { accountId: string; promise: Promise<NoteCardPickerCircle[]> } | null = null;

function isFresh<T>(entry: CacheEntry<T> | null, accountId: string | null | undefined) {
  return Boolean(
    entry &&
      accountId &&
      entry.accountId === accountId &&
      Date.now() - entry.updatedAt < NOTE_CARD_PICKER_CACHE_TTL_MS,
  );
}

function readCirclesFromGlobalStore(accountId: string | null | undefined) {
  if (!accountId) return null;
  let useCirclesStore: typeof import('@/features/discover/store/use-circles-store').useCirclesStore;
  try {
    // Keep the store out of the editor's initial module graph to avoid the API/session cycle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ useCirclesStore } = require('@/features/discover/store/use-circles-store') as typeof import('@/features/discover/store/use-circles-store'));
  } catch {
    // The picker still has its direct API fallback if the optional store cannot load.
    return null;
  }
  const state = useCirclesStore.getState();
  if (state.myCirclesLoading || state.myCirclesError) return null;

  const byId = new Map<string, NoteCardPickerCircle>();
  for (const circle of [...state.joinedCircles, ...state.createdCircles]) {
    byId.set(circle.id, {
      id: circle.id,
      name: circle.name,
      avatarUrl: circle.avatarUrl,
    });
  }
  return byId.size > 0 ? [...byId.values()] : null;
}

function primeCirclesFromGlobalStore(accountId: string | null | undefined) {
  const circles = readCirclesFromGlobalStore(accountId);
  if (!circles || !accountId) return circles;
  circlesCache = {
    accountId,
    value: circles,
    updatedAt: Date.now(),
  };
  return circles;
}

export function getCachedNotePickerFriends(accountId: string | null | undefined) {
  return accountId && friendsCache?.accountId === accountId ? friendsCache.value : null;
}

export function getCachedNotePickerCircles(accountId: string | null | undefined) {
  return accountId && circlesCache?.accountId === accountId ? circlesCache.value : null;
}

export function isNotePickerFriendsFresh(accountId: string | null | undefined) {
  return isFresh(friendsCache, accountId);
}

export function isNotePickerCirclesFresh(accountId: string | null | undefined) {
  return isFresh(circlesCache, accountId);
}

export async function loadNotePickerFriends(accountId: string | null | undefined) {
  const key = accountId ?? 'anonymous';
  if (friendsInFlight?.accountId === key) return friendsInFlight.promise;

  let promise: Promise<FriendProfile[]>;
  promise = Promise.resolve()
    .then(() => {
      // The friends API remains lazy so opening the editor does not load its session graph.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { fetchFriends } = require('@/services/api/friends') as typeof import('@/services/api/friends');
      return fetchFriends();
    })
    .then((friends) => {
      friendsCache = {
        accountId: key,
        value: friends,
        updatedAt: Date.now(),
      };
      return friends;
    })
    .finally(() => {
      if (friendsInFlight?.promise === promise) friendsInFlight = null;
    });

  friendsInFlight = { accountId: key, promise };
  return promise;
}

export async function loadNotePickerCircles(accountId: string | null | undefined) {
  const key = accountId ?? 'anonymous';
  const globalCircles = primeCirclesFromGlobalStore(accountId);
  if (globalCircles) return globalCircles;
  if (circlesInFlight?.accountId === key) return circlesInFlight.promise;

  let promise: Promise<NoteCardPickerCircle[]>;
  promise = Promise.resolve()
    .then(async () => {
      // The circles API remains lazy for the same reason as the friends API above.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { fetchMyCircles } = require('@/services/api/circles') as typeof import('@/services/api/circles');
      const [joined, created] = await Promise.all([
        fetchMyCircles('joined'),
        fetchMyCircles('created'),
      ]);
      const byId = new Map<string, NoteCardPickerCircle>();
      for (const circle of [...joined, ...created]) {
        byId.set(circle.id, {
          id: circle.id,
          name: circle.name,
          avatarUrl: circle.avatarUrl,
        });
      }
      return [...byId.values()];
    })
    .then((circles) => {
      circlesCache = {
        accountId: key,
        value: circles,
        updatedAt: Date.now(),
      };
      return circles;
    })
    .finally(() => {
      if (circlesInFlight?.promise === promise) circlesInFlight = null;
    });

  circlesInFlight = { accountId: key, promise };
  return promise;
}

/** Warm both card pickers after the editor is idle so the first tap is local. */
export async function prefetchNoteCardPickerData(accountId: string | null | undefined) {
  if (!accountId) return;
  primeCirclesFromGlobalStore(accountId);
  await Promise.allSettled([
    isNotePickerFriendsFresh(accountId)
      ? Promise.resolve()
      : loadNotePickerFriends(accountId),
    isNotePickerCirclesFresh(accountId)
      ? Promise.resolve()
      : loadNotePickerCircles(accountId),
  ]);
}
