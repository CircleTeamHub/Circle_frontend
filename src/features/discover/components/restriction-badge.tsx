import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FEATURE_FLAGS } from '@/constants/feature-flags';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

type IdentityBadge = {
  icon: IoniconName;
  label: string;
  color: string;
};

interface RestrictionBadgeProps {
  restrictions: {
    vipLevel: number | null;
    creditScore: number | null;
    fancyNumber: boolean;
  };
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  text: {
    ...Typography.tinyRegular,
    fontWeight: '600',
  },
});

export const RestrictionBadge: React.FC<RestrictionBadgeProps> = ({
  restrictions,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const badges = useMemo(() => {
    const items: IdentityBadge[] = [];
    if (restrictions.vipLevel != null) {
      items.push({
        icon: 'diamond-outline',
        label: t('discover.restrictionBadge.vip', {
          level: restrictions.vipLevel,
          defaultValue: `VIP${restrictions.vipLevel}+`,
        }),
        color: colors.badgeVip,
      });
    }
    if (restrictions.creditScore != null) {
      items.push({
        icon: 'shield-checkmark-outline',
        label: t('discover.restrictionBadge.credit', {
          score: restrictions.creditScore,
          defaultValue: `信用${restrictions.creditScore}+`,
        }),
        color: colors.badgeCredit,
      });
    }
    if (FEATURE_FLAGS.fancyNumbers && restrictions.fancyNumber) {
      items.push({
        icon: 'sparkles-outline',
        label: t('discover.restrictionBadge.fancyNumber', {
          defaultValue: '靓号',
        }),
        color: colors.badgeFancy,
      });
    }
    return items;
  }, [restrictions, t, colors]);

  if (badges.length === 0) return null;

  return (
    <View style={s.row}>
      {badges.map((b, index) => (
        <View
          key={`${b.icon}-${b.label}-${index}`}
          style={[
            s.badge,
            { backgroundColor: b.color },
          ]}
        >
          <Ionicons name={b.icon} size={10} color={colors.white} />
          <Text style={[s.text, { color: colors.white }]}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
};
