/**
 * Frontend-only rollout switches. The API contracts and response fields stay
 * available while these surfaces are temporarily removed from the app.
 */
export const FEATURE_FLAGS = {
  avatarFrames: false,
  fancyNumbers: false,
} as const;
