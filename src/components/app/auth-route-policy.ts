type AuthRouteDecision =
  | { type: 'allow' }
  | { type: 'loading' }
  | {
      type: 'redirect';
      href: '/(auth)/login' | '/(tabs)/messages' | '/(onboarding)/profile';
    };

type AuthRouteDecisionInput = {
  firstSegment: string | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
  onboardingRequired: boolean;
};

export function getAuthRouteDecision({
  firstSegment,
  isAuthenticated,
  isLoading,
  onboardingRequired,
}: AuthRouteDecisionInput): AuthRouteDecision {
  const isAuthRoute = firstSegment === '(auth)';
  const isOnboardingRoute = firstSegment === '(onboarding)';

  if (isLoading) {
    return isAuthRoute ? { type: 'allow' } : { type: 'loading' };
  }

  if (onboardingRequired) {
    return isOnboardingRoute
      ? { type: 'allow' }
      : { type: 'redirect', href: '/(onboarding)/profile' };
  }

  if (!isAuthenticated && !isAuthRoute) {
    return { type: 'redirect', href: '/(auth)/login' };
  }

  if (isAuthenticated && !onboardingRequired && isOnboardingRoute) {
    return { type: 'redirect', href: '/(tabs)/messages' };
  }

  if (isAuthenticated && isAuthRoute) {
    return { type: 'redirect', href: '/(tabs)/messages' };
  }

  return { type: 'allow' };
}
