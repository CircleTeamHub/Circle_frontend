import type { BurnDurationSec } from '@/chat-core/burn-durations';
import { apiClient } from '@/services/api/client';

export type MomentsVisibility = 'ALL' | 'FRIENDS_ONLY' | 'PRIVATE';
export type PrivacyPermission = 'EVERYONE' | 'FRIENDS_ONLY' | 'NONE';

export type PrivacySettings = {
  // 全局阅后即焚窗口(秒)。与会话级焚毁共用 BURN_DURATION_CHOICES 那张表 ——
  // 旧字段是 messageSelfDestructDays,只能选整天,于是同一个功能在两个入口给出
  // 两张不一样的档位表。
  messageSelfDestructSec: BurnDurationSec;
  /** 开启时间；开启前发送的消息不受阅后即焚影响。 */
  messageSelfDestructStartedAt?: string | null;
  momentsVisibility: MomentsVisibility;
  allowStrangerMessages: boolean;
  showPhone: boolean;
  // 注册邮箱：后端默认 false（与 showPhone 同档），不是 wechat/qq 那档默认 true。
  showEmail: boolean;
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
  // Optional during a rolling backend deployment; new servers always return both.
  directMessageAutoReplyEnabled?: boolean;
  directMessageAutoReplyText?: string;
  // 同上:滚动发布期间旧服务端不返回这三项,读的一侧一律 `?? true`(与后端默认一致)。
  /** 对他人显示在线状态与最近在线时间(在线点 / 「N 分钟前在线」)。 */
  shareOnlineStatus?: boolean;
  /** 单聊 / 群聊里向对方上报「正在输入」;门禁在 socket-manager 的 sendChatTyping。 */
  shareTypingInDirect?: boolean;
  shareTypingInGroup?: boolean;
};

export type UpdatePrivacySettingsPayload = Partial<
  Omit<PrivacySettings, 'messageSelfDestructStartedAt'>
>;

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
