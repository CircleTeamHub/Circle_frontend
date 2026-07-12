// Note: this file used to ship ~150 lines of hardcoded mock user data
// (USER_PROFILES with 8 fake users: 陈思琪 / 张明远 / 李晓婷 etc., fake phone
// numbers, Unsplash avatar URLs). The mock was wired as the UserProfileScreen
// fallback but only ever served if a navigation passed one of the mock ids —
// real backend userIDs (UUIDs / numeric) never matched, so the data was
// effectively dead in production but still shipped in the bundle.
//
// Cleaned up: only the type definition remains. UserProfileScreen now builds
// its own minimal fallback profile inline.
export interface UserProfileData {
  id: string;
  name: string;
  accountId: string;
  avatarUrl?: string;
  memberLabel: string;
  badges: string[];
  displayIcons?: import('@/types').DisplayIcon[];
  likeCount?: number;
  recognitionCount?: number;
  gender?: string | null;
  city?: string | null;
  signature: string;
  phone: string;
  remarkHint?: string;
}
