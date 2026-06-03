import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography } from '@/theme';

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

// Brand colors not yet mapped into the theme palette. Tracked in REVIEW_PROGRESS #45.
const BADGE_COLOR = {
  vip: '#F59E0B',
  credit: '#3B82F6',
  fancyNumber: '#A855F7',
} as const;

export const RestrictionBadge: React.FC<RestrictionBadgeProps> = ({
  restrictions,
}) => {
  const { t } = useTranslation();

  const badges = useMemo(() => {
    const items: IdentityBadge[] = [];
    if (restrictions.vipLevel != null) {
      items.push({
        icon: 'diamond-outline',
        label: t('discover.restrictionBadge.vip', {
          level: restrictions.vipLevel,
          defaultValue: `VIP${restrictions.vipLevel}+`,
        }),
        color: BADGE_COLOR.vip,
      });
    }
    if (restrictions.creditScore != null) {
      items.push({
        icon: 'shield-checkmark-outline',
        label: t('discover.restrictionBadge.credit', {
          score: restrictions.creditScore,
          defaultValue: `信用${restrictions.creditScore}+`,
        }),
        color: BADGE_COLOR.credit,
      });
    }
    if (restrictions.fancyNumber) {
      items.push({
        icon: 'sparkles-outline',
        label: t('discover.restrictionBadge.fancyNumber', {
          defaultValue: '靓号',
        }),
        color: BADGE_COLOR.fancyNumber,
      });
    }
    return items;
  }, [restrictions, t]);

  if (badges.length === 0) return null;

  return (
    <View style={s.row}>
      {badges.map((b, index) => (
        <View
          key={`${b.icon}-${b.label}-${index}`}
          style={[
            s.badge,
            { backgroundColor: `${b.color}20` },
          ]}
        >
          <Ionicons name={b.icon} size={10} color={b.color} />
          <Text style={[s.text, { color: b.color }]}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
};
