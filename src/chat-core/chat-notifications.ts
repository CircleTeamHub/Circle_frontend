import { Platform } from 'react-native';
import i18n from '@/i18n';
import { reportHandledFailure } from '@/observability/report-failure';

/**
 * 聊天通知在设备上的那一半:安卓通知渠道,以及「看过、撤回、焚毁之后把通知栏里
 * 对应的通知收起来」。
 *
 * 渠道 id 是跨仓契约:后端聊天推送带 channelId = CHAT_PUSH_CHANNEL_ID
 * (circle_be src/chat/chat.constants.ts),两边必须同值。设备上没建这个渠道时
 * expo-notifications 会回落到默认渠道,所以老版本 App 照样收得到。
 */
export const CHAT_NOTIFICATION_CHANNEL_ID = 'chat';

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
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    // 锁屏上只显示「有新消息」,正文要解锁才看得到。
    lockscreenVisibility: notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: true,
  });
}

/**
 * 收起通知栏里属于这个会话的聊天通知;给了 messageIds 就只收这几条。
 *
 * 本机读过、本人别的设备读过、清空之后收整个会话;撤回、焚毁之后只收那几条 ——
 * 否则消息已经不在了,通知栏里的正文还在。尽力而为,失败不影响聊天本身。
 */
export function dismissChatNotifications(
  conversationId: string,
  messageIds?: readonly string[],
): void {
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
        return (
          wanted === null ||
          (typeof data.messageId === 'string' && wanted.has(data.messageId))
        );
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
