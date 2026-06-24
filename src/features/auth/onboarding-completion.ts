type OnboardingProfileCandidate = {
  avatarUrl?: string | null;
  nickname?: string | null;
};

export function hasCompletedOnboardingProfile(
  user: OnboardingProfileCandidate | null | undefined,
) {
  return Boolean(user?.avatarUrl?.trim() && user?.nickname?.trim());
}
