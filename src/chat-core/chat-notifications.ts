import { Platform } from 'react-native';
import i18n from '@/i18n';
import { reportHandledFailure } from '@/observability/report-failure';
import { useChatStore } from './store';

/**
 * 聊天通知在设备上的那一半:安卓通知渠道,以及「看过、撤回、焚毁之后把通知栏里
 * 对应的通知收起来」。
 *
 * 渠道 id 是跨仓契约:后端聊天推送带 channelId = CHAT_PUSH_CHANNEL_ID
 * (circle_be src/chat/chat.constants.ts),两边必须同值。后端按登记的 App 版本
 * 选择新/旧渠道，新客户端会在原生启动时创建带声音的新渠道。
 */
export const CHAT_NOTIFICATION_CHANNEL_ID = 'chat_swift_gesture';

type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: Promise<NotificationsModule | null> | null = null;

function loadNotifications(): Promise<NotificationsModule | null> {
  // 网页版没有系统通知栏可收。
  if (Platform.OS === 'web') return Promise.resolve(null);
  notificationsModule ??= import('expo-notifications').catch((error: unknown) => {
    reportHandledFailure('notifications', 'moduleUnavailable', error);
    return null;
  });
  return notificationsModule;
}

/**
 * 建聊天通知渠道(高重要性:横幅 + 声音)。要在请求通知权限之前调用 —— 安卓 13
 * 起应用一个渠道都没有时,系统不会弹权限框。重复调用只会更新名称与描述。
 */
export async function ensureChatNotificationChannel(
  notifications: NotificationsModule,
): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifications.setNotificationChannelAsync(CHAT_NOTIFICATION_CHANNEL_ID, {
    name: i18n.t('notifications.chatChannelName'),
    description: i18n.t('notifications.chatChannelDescription'),
    importance: notifications.AndroidImportance.HIGH,
    // 原生启动时先迁移旧渠道的用户设置；重复设置不会覆盖已有静音或自选声音。
    sound: 'notification_swift_gesture.wav',
    vibrationPattern: [0, 250, 250, 250],
    // 锁屏上只显示「有新消息」,正文要解锁才看得到。
    lockscreenVisibility: notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: true,
  });
}

/**
 * 收起会话的聊天通知；messageIds 限定消息，throughHeight 限定已读水位。
 *
 * 本机和其它设备的已读只能清理水位以内；清空、撤回、焚毁保持原有范围。
 * 旧推送不带序号时，仅按缓存里能确认已读的消息 ID 清理。
 */
export function dismissChatNotifications(
  conversationId: string,
  messageIds?: readonly string[],
  throughHeight?: number,
): void {
  const legacyReadIds = new Set<string>();
  if (throughHeight !== undefined) {
    const state = useChatStore.getState();
    for (const message of state.messagesByConversation[conversationId] ?? []) {
      if (message.height <= throughHeight) legacyReadIds.add(message.id);
    }
    const lastMessage = state.conversations.find((item) => item.id === conversationId)?.lastMessage;
    if (lastMessage && lastMessage.height <= throughHeight) legacyReadIds.add(lastMessage.id);
  }
  void loadNotifications()
    .then(async (notifications) => {
      if (!notifications) return;
      const presented = await notifications.getPresentedNotificationsAsync();
      const wanted = messageIds ? new Set(messageIds) : null;
      const matching = presented.filter((notification) => {
        const data = notification.request.content.data as
          | Record<string, unknown>
          | null
          | undefined;
        if (data?.type !== 'chat' || data.conversationId !== conversationId) {
          return false;
        }
        const messageId = typeof data.messageId === 'string' ? data.messageId : null;
        if (wanted && (messageId === null || !wanted.has(messageId))) return false;
        if (throughHeight === undefined) return true;
        if (typeof data.height === 'number' && Number.isSafeInteger(data.height) && data.height > 0) {
          return data.height <= throughHeight;
        }
        return messageId !== null && legacyReadIds.has(messageId);
      });
      await Promise.all(
        matching.map((notification) =>
          notifications.dismissNotificationAsync(notification.request.identifier),
        ),
      );
    })
    .catch((error: unknown) => {
      reportHandledFailure('notifications', 'dismissChatNotifications', error);
    });
}
