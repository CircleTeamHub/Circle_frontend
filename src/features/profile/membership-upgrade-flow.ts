import { getApiErrorMessage } from '@/services/api/errors';
import type { AuthUser } from '@/stores/authStore';
import type {
  MembershipUser,
  UpgradeMembershipResponse,
} from '@/services/api/membership';

type Translate = (
  key: string,
  options?: Record<string, unknown>
) => string;

type MembershipUpgradeFlowOptions = {
  selectedLevel: number;
  upgradeMembership: (level: number) => Promise<UpgradeMembershipResponse>;
  fetchCurrentUser: () => Promise<AuthUser>;
  getCurrentUser: () => AuthUser | null;
  setUser: (user: AuthUser) => void;
  setStatusText: (text: string) => void;
  t: Translate;
};

export function mergeMembershipUser(
  currentUser: AuthUser | null,
  upgradedUser: MembershipUser
): AuthUser | null {
  if (!currentUser || currentUser.id !== upgradedUser.id) {
    return null;
  }

  return {
    ...currentUser,
    vipLevel: upgradedUser.vipLevel,
    creditScore: upgradedUser.creditScore,
  };
}

export async function performMembershipUpgradeFlow({
  selectedLevel,
  upgradeMembership,
  fetchCurrentUser,
  getCurrentUser,
  setUser,
  setStatusText,
  t,
}: MembershipUpgradeFlowOptions): Promise<void> {
  try {
    const result = await upgradeMembership(selectedLevel);
    const mergedUser = mergeMembershipUser(getCurrentUser(), result.user);
    if (mergedUser) {
      setUser(mergedUser);
    }
    setStatusText(
      t('profile.membership.exchangeSuccess', {
        defaultValue: '已成功兑换 VIP{{level}}',
        level: result.user.vipLevel,
      })
    );

    try {
      const nextUser = await fetchCurrentUser();
      setUser(nextUser);
    } catch {
      // The upgrade already succeeded. Keep the optimistic membership snapshot
      // instead of turning a post-success refresh failure into a false failure.
    }
  } catch (err) {
    setStatusText(
      getApiErrorMessage(
        err,
        t('profile.membership.exchangeError', {
          defaultValue: '兑换失败，请确认积分余额足够后重试',
        })
      )
    );
  }
}
