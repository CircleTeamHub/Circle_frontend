import { apiClient } from '@/services/api/client';

export type SelfDestructDays = 0 | 1 | 2 | 7 | 30;
export type MomentsVisibility = 'ALL' | 'FRIENDS_ONLY' | 'PRIVATE';
export type PrivacyPermission = 'EVERYONE' | 'FRIENDS_ONLY' | 'NONE';

export type PrivacySettings = {
  messageSelfDestructDays: SelfDestructDays;
  momentsVisibility: MomentsVisibility;
  allowStrangerMessages: boolean;
  showPhone: boolean;
  showWechat: boolean;
  showQQ: boolean;
  // 后端 canViewProfileField 认这个字段，但它守的 whatsup profile 字段在 App 里
  // 是休眠的：profile-edit-config.ts 不收录它，也没有任何界面渲染它。所以这里只
  // 补齐类型让客户端契约与服务端一致，隐私设置页**不放开关** —— 给一个用户既
  // 看不到也填不了的字段配可见性开关，就是又造一个「能拨、不通电」的控件。
  // whatsup 真正接进资料页时，连同这一行一起放出来。
  showWhatsup: boolean;
  addMeByAccount: boolean;
  addMeByPhone: boolean;
  addMeByQrCode: boolean;
  addMeByGroup: boolean;
  callPermission: PrivacyPermission;
  groupInvitePermission: PrivacyPermission;
};

export type UpdatePrivacySettingsPayload = Partial<PrivacySettings>;

export async function fetchPrivacySettings() {
  return apiClient<PrivacySettings>('/privacy/settings');
}

export async function updatePrivacySettings(
  payload: UpdatePrivacySettingsPayload,
) {
  return apiClient<PrivacySettings>('/privacy/settings', {
    method: 'PATCH',
    body: payload,
  });
}
