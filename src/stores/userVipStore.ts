import {
  useRequestUserAppearance,
  useUserAppearanceStore,
} from '@/stores/userAppearanceStore';

/** Existing VIP-only hook projected from the shared appearance cache. */
export function useUserVipLevel(userId?: string | null): number | undefined {
  const normalizedId = userId?.trim();
  const level = useUserAppearanceStore((state) =>
    normalizedId ? state.appearances[normalizedId]?.vipLevel : undefined,
  );
  useRequestUserAppearance(normalizedId);
  return level;
}
