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
  fancyNumber?: boolean;
  avatarUrl?: string;
  avatarFrameAppearance: import('@/types').AvatarFrameAppearance | null;
  vipLevel?: number | null;
  displayIcons?: import('@/types').DisplayIcon[];
  likeCount?: number;
  recognitionCount?: number;
  gender?: string | null;
  city?: string | null;
  signature: string;
  contact: ProfileContact;
  remarkHint?: string;
}

/**
 * 对方**选择公开**给当前查看者的联系方式。
 *
 * 后端 applyProfilePrivacy 已按 showPhone / showEmail / showWechat / showQQ 把
 * 关掉的字段置成 null,所以客户端的规则只有一条:**有值就展示,没值就整行不渲染**。
 * 千万别在这里再叠一层自己的可见性判断 —— 那等于让客户端和服务端各裁决一次,
 * 两边一旦不同步,要么泄露(客户端更松)、要么开关看着失灵(客户端更严)。
 */
export interface ProfileContact {
  phone: string | null;
  email: string | null;
  wechat: string | null;
  qq: string | null;
}

export const EMPTY_PROFILE_CONTACT: ProfileContact = {
  phone: null,
  email: null,
  wechat: null,
  qq: null,
};
