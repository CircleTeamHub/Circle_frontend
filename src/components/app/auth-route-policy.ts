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
  // 邀请链接的收件人多半还没登录。/invite 不在 (auth) 分组里,不单独放行的话
  // 根守卫会发一个去 login 的重定向,与这个页面自己「带着邀请码去注册页」的
  // 重定向打架,邀请码就丢了 —— 那是整条拉新链路的入口。
  // 放行 ≠ 当成 (auth) 页:已登录的人打开邀请链接不该被弹回消息页,而是由
  // 页面自己送去邀请中心,所以这里与 isAuthRoute 分开表达。
  const isPublicRoute = isAuthRoute || firstSegment === 'invite';

  if (isLoading) {
    return isPublicRoute ? { type: 'allow' } : { type: 'loading' };
  }

  if (onboardingRequired) {
    return isOnboardingRoute
      ? { type: 'allow' }
      : { type: 'redirect', href: '/(onboarding)/profile' };
  }

  if (!isAuthenticated && !isPublicRoute) {
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
