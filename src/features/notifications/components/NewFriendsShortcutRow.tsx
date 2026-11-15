import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, useTheme } from '@/theme';
import { UnreadCountBadge } from '@/components/ui/unread-count-badge';

interface Props {
  /** 待处理的好友申请 + 入群申请。 */
  count: number;
  onPress: () => void;
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + Spacing.xs,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: Spacing.xs },
  title: { fontSize: 16, fontWeight: '700' },
  subtitle: { fontSize: 14 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
});

/**
 * 「通知」页首的「新的朋友」入口。好友申请 / 入群申请要在它们自己的处理页里同意或拒绝，
 * 不拷进通知列表 —— 拷进来就是两份已读状态，一边看过另一边的红点还挂着。
 */
export const NewFriendsShortcutRow = memo(function NewFriendsShortcutRow({
  count,
  onPress,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      style={s.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('notifications.notice.newFriends')}
      testID="notice-new-friends-shortcut"
    >
      <View style={[s.icon, { backgroundColor: colors.primaryLight }]}>
        <Ionicons name="person-add-outline" size={22} color={colors.iconAccent} />
      </View>
      <View style={s.body}>
        <Text style={[s.title, { color: colors.text }]} numberOfLines={1}>
          {t('notifications.notice.newFriends')}
        </Text>
        <Text style={[s.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {t('notifications.notice.newFriendsHint')}
        </Text>
      </View>
      <View style={s.trailing}>
        <UnreadCountBadge count={count} />
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </View>
    </Pressable>
  );
});
