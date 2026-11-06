import { Ionicons } from '@expo/vector-icons';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { type TFunction } from 'i18next';
import { Avatar } from '@/components/ui/avatar';
import { type ChatDetailThemedStyles } from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { type MentionTarget } from '@/features/chat/utils/chat-send-payloads';
import { Radius, Spacing, Typography, withAlpha, type ThemeColors } from '@/theme';

export interface MentionPickerPanelProps {
  colors: ThemeColors;
  t: TFunction<"translation", undefined>;
  mentionPickerVisible: boolean;
  /** 保留给调用方传主题样式;面板自己的外观在本文件里定义。 */
  d?: ChatDetailThemedStyles;
  visibleMentionCandidates: MentionTarget[];
  handlePickMention: (target: MentionTarget) => void;
}

const AVATAR_SIZE = 36;

const s = StyleSheet.create({
  panel: {
    maxHeight: 300,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerTitle: { ...Typography.caption, fontWeight: '700' },
  headerCount: { ...Typography.small },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  allIcon: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  name: { ...Typography.body },
  hint: { ...Typography.small },
  roleChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  roleText: { ...Typography.tiny },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.md + AVATAR_SIZE + Spacing.md },
  empty: { ...Typography.bodyRegular, textAlign: 'center', paddingVertical: Spacing.lg },
});

/**
 * 群聊输入 @ 时在输入框上方浮起的成员候选:「所有人」单独突出放在最上面,
 * 成员带头像和群主/管理员标签,方便在长名单里一眼认出要提醒的人。
 */
export function MentionPickerPanel({
  colors,
  t,
  mentionPickerVisible,
  visibleMentionCandidates,
  handlePickMention,
}: MentionPickerPanelProps) {
  if (!mentionPickerVisible) return null;
  const memberCount = visibleMentionCandidates.filter((member) => !member.isAll).length;

  const renderRole = (role: MentionTarget['role']) => {
    if (role !== 'OWNER' && role !== 'ADMIN') return null;
    const tone = role === 'OWNER' ? colors.warningText : colors.iconAccent;
    return (
      <View style={[s.roleChip, { backgroundColor: withAlpha(tone, 0.14) }]}>
        <Text style={[s.roleText, { color: tone }]}>
          {role === 'OWNER' ? t('chat.groupOwner') : t('chat.groupAdmin')}
        </Text>
      </View>
    );
  };

  return (
    <View
      style={[
        s.panel,
        {
          backgroundColor: colors.surface,
          borderColor: colors.surfaceBorder,
          shadowColor: colors.black,
        },
      ]}
    >
      <View style={s.header}>
        <Text style={[s.headerTitle, { color: colors.text }]}>
          {t('chat.mentions.title', { defaultValue: '选择提醒的人' })}
        </Text>
        {memberCount > 0 ? (
          <Text style={[s.headerCount, { color: colors.text }]}>
            {t('chat.mentions.count', { count: memberCount, defaultValue: '{{count}} 位成员' })}
          </Text>
        ) : null}
      </View>
      <FlatList
        data={visibleMentionCandidates}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(member) => member.userID}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={4}
        ItemSeparatorComponent={() => (
          <View style={[s.separator, { backgroundColor: colors.divider }]} />
        )}
        renderItem={({ item: member }) => (
          <Pressable
            style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.inputBg }]}
            onPress={() => handlePickMention(member)}
            accessibilityRole="button"
            accessibilityLabel={member.nickname}
          >
            {member.isAll ? (
              <View style={[s.allIcon, { backgroundColor: withAlpha(colors.primary, 0.14) }]}>
                <Ionicons name="people" size={18} color={colors.iconAccent} />
              </View>
            ) : (
              <Avatar size={AVATAR_SIZE} shape="square" name={member.nickname} uri={member.avatarUrl} />
            )}
            <View style={s.rowText}>
              <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>
                {member.isAll
                  ? t('chat.mentions.all', { defaultValue: '所有人' })
                  : member.nickname}
              </Text>
              {member.isAll ? (
                <Text style={[s.hint, { color: colors.text }]} numberOfLines={1}>
                  {t('chat.mentions.allHint', { defaultValue: '提醒群里每一个人' })}
                </Text>
              ) : null}
            </View>
            {member.isAll ? null : renderRole(member.role)}
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={[s.empty, { color: colors.text }]}>
            {t('chat.mentions.empty', { defaultValue: '暂无可 @ 的成员' })}
          </Text>
        }
      />
    </View>
  );
}
