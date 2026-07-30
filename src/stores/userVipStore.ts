import {
  invalidateUserAppearances,
  requestUserAppearance,
  useRequestUserAppearance,
  useUserAppearance,
  useUserAppearanceStore,
} from '@/stores/userAppearanceStore';

/** Compatibility alias; new code should subscribe to useUserAppearanceStore. */
export const useUserVipStore = useUserAppearanceStore;

/** Compatibility delegate for existing callers. */
export function requestVipLevel(userId: string): void {
  requestUserAppearance(userId);
}

/** Clears the shared appearance/VIP cache on logout or explicit invalidation. */
export function invalidateVipLevels(): void {
  invalidateUserAppearances();
}

/** Existing VIP-only hook projected from the shared appearance cache. */
export function useUserVipLevel(userId?: string | null): number | undefined {
  const normalizedId = userId?.trim();
  const level = useUserAppearanceStore((state) =>
    normalizedId ? state.levels[normalizedId] : undefined,
  );
  useRequestUserAppearance(normalizedId);
  return level;
}

export {
  invalidateUserAppearances,
  requestUserAppearance,
  useRequestUserAppearance,
  useUserAppearance,
  useUserAppearanceStore,
};
