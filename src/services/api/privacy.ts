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
