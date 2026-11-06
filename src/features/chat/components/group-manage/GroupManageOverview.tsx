import { Fragment, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface Props {
  memberCount: number;
  adminCount: number;
  silencedCount: number;
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: Radius.xl,
    paddingVertical: Spacing.md,
  },
  stat: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  value: { ...Typography.h2 },
  label: { ...Typography.small },
  divider: { width: StyleSheet.hairlineWidth, marginVertical: Spacing.xs },
});

/** 群管理页顶部概览:成员数 / 管理员数 / 禁言中人数。 */
export const GroupManageOverview: React.FC<Props> = ({ memberCount, adminCount, silencedCount }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({
      card: { backgroundColor: colors.surface },
      value: { color: colors.text },
      label: { color: colors.textSecondary },
      divider: { backgroundColor: colors.divider },
    }),
    [colors],
  );
  const stats = [
    { key: 'members', value: memberCount, label: t('chat.groupManagement.overview.members') },
    { key: 'admins', value: adminCount, label: t('chat.groupManagement.overview.admins') },
    { key: 'silenced', value: silencedCount, label: t('chat.groupManagement.overview.silenced') },
  ];
  return (
    <View style={[s.card, d.card]} testID="group-manage-overview">
      {stats.map((stat, index) => (
        <Fragment key={stat.key}>
          {index > 0 ? <View style={[s.divider, d.divider]} /> : null}
          <View style={s.stat}>
            <Text style={[s.value, d.value]}>{stat.value}</Text>
            <Text style={[s.label, d.label]}>{stat.label}</Text>
          </View>
        </Fragment>
      ))}
    </View>
  );
};
