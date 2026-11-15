import { memo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Bell } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { UnreadCountBadge } from '@/components/ui/unread-count-badge';
import { useTheme } from '@/theme';
import { selectNoticeUnread, useTabBadgeStore } from '@/stores/tabBadgeStore';

interface Props {
  /** 页头按钮的统一尺寸(24×24),由消息页传入。 */
  style: StyleProp<ViewStyle>;
  onPress: () => void;
}

const s = StyleSheet.create({
  // 角标压在铃铛右上角,外圈一道页面底色,像从图标上挖出来的(和飞机的红点同一手法)。
  badge: {
    position: 'absolute',
    top: -8,
    left: 14,
    borderWidth: 2,
    borderRadius: 999,
  },
});

/**
 * 消息页右上角的「通知」:圈子以外所有知会的入口(互动、好友·群、系统)。圈子的事走旁边的
 * 飞机,不进这里。和飞机不同,这里给数字:通知数没有别处单独显示(消息 tab 角标里混着聊天未读)。
 * 自己订阅计数,未读变化只重渲这一个按钮,不带着整个页头。
 */
export const NoticeHeaderButton = memo(function NoticeHeaderButton({ style, onPress }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const unread = useTabBadgeStore(selectNoticeUnread);
  const title = t('notifications.notice.title');
  return (
    <Pressable
      style={style}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `${title}, ${t('common.unreadCount', { count: unread })}` : title}
      hitSlop={10}
      onPress={onPress}
      testID="messages-notice-button"
    >
      <Bell size={24} strokeWidth={4} color={colors.text} />
      {unread > 0 ? (
        <View style={[s.badge, { borderColor: colors.background }]} pointerEvents="none">
          <UnreadCountBadge count={unread} testID="messages-notice-badge" />
        </View>
      ) : null}
    </Pressable>
  );
});
