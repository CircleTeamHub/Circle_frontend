import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { groupMemberDisplayName } from '@/features/chat/group-member-display';
import type { AbnormalMemberRow } from '@/features/chat/hooks/use-group-abnormal-members';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const DAY_MS = 86_400_000;

interface Props {
  row: AbnormalMemberRow;
  inactiveDays: number;
  selected: boolean;
  /** 已选满上限时未选中的行变灰、不可点。 */
  disabled: boolean;
  onToggle: (userId: string) => void;
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + Spacing.xs,
  },
  body: { flex: 1, gap: Spacing.xs },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.body, flexShrink: 1 },
  roleBadge: {
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.xs,
  },
  roleText: { ...Typography.tiny },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs / 2,
    borderRadius: Radius.full,
  },
  tagText: { ...Typography.small },
  dimmed: { opacity: 0.4 },
});

function inactiveTag(
  lastActiveAt: string | null,
  inactiveDays: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const at = lastActiveAt ? Date.parse(lastActiveAt) : Number.NaN;
  if (!Number.isFinite(at)) {
    return t('chat.groupManagement.abnormal.tagInactiveOver', { n: inactiveDays });
  }
  const days = Math.max(inactiveDays, Math.floor((Date.now() - at) / DAY_MS));
  return t('chat.groupManagement.abnormal.tagInactiveDays', { n: days });
}

/** 异常成员一行:头像、名字(管理员带标)、命中原因标签、勾选框;整行点选。 */
export const AbnormalMemberItem: React.FC<Props> = memo(function AbnormalMemberItem({
  row,
  inactiveDays,
  selected,
  disabled,
  onToggle,
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { member, flag } = row;
  const name = groupMemberDisplayName(member);

  const d = useMemo(
    () => ({
      name: { color: colors.text },
      roleBadge: { backgroundColor: colors.primaryLight },
      roleText: { color: colors.primary },
      inactiveTag: { backgroundColor: colors.surfaceMuted },
      inactiveText: { color: colors.warningText },
      creditTag: { backgroundColor: colors.surfaceMuted },
      creditText: { color: colors.danger },
    }),
    [colors],
  );

  return (
    <Pressable
      style={[s.row, disabled && !selected ? s.dimmed : null]}
      onPress={() => onToggle(member.userId)}
      disabled={disabled && !selected}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: disabled && !selected }}
      accessibilityLabel={name}
      testID={`abnormal-member-${member.userId}`}
    >
      <Avatar size={44} shape="square" name={name} uri={member.avatarUrl ?? undefined} />
      <View style={s.body}>
        <View style={s.nameLine}>
          <Text style={[s.name, d.name]} numberOfLines={1}>
            {name}
          </Text>
          {member.role === 'ADMIN' ? (
            <View style={[s.roleBadge, d.roleBadge]}>
              <Text style={[s.roleText, d.roleText]}>
                {t('chat.groupManagement.abnormal.adminBadge')}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={s.tags}>
          {flag.reasons.includes('INACTIVE') ? (
            <View style={[s.tag, d.inactiveTag]}>
              <Ionicons name="time-outline" size={12} color={colors.warningText} />
              <Text style={[s.tagText, d.inactiveText]}>
                {inactiveTag(flag.lastActiveAt, inactiveDays, t)}
              </Text>
            </View>
          ) : null}
          {flag.reasons.includes('LOW_CREDIT') && flag.creditScore !== null ? (
            <View style={[s.tag, d.creditTag]}>
              <Ionicons name="shield-outline" size={12} color={colors.danger} />
              <Text style={[s.tagText, d.creditText]}>
                {t('chat.groupManagement.abnormal.tagLowCredit', { score: flag.creditScore })}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={24}
        color={selected ? colors.danger : colors.textSecondary}
      />
    </Pressable>
  );
});
