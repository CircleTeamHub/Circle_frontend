import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

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
  const { colors } = useTheme();

  const badges = useMemo(() => {
    const items: { icon: string; label: string; color: string }[] = [];
    if (restrictions.vipLevel != null) {
      items.push({
        icon: 'diamond-outline',
        label: `VIP${restrictions.vipLevel}+`,
        color: '#F59E0B',
      });
    }
    if (restrictions.creditScore != null) {
      items.push({
        icon: 'shield-checkmark-outline',
        label: `信用${restrictions.creditScore}+`,
        color: '#3B82F6',
      });
    }
    if (restrictions.fancyNumber) {
      items.push({
        icon: 'sparkles-outline',
        label: '靓号',
        color: '#A855F7',
      });
    }
    return items;
  }, [restrictions]);

  if (badges.length === 0) return null;

  return (
    <View style={s.row}>
      {badges.map((b) => (
        <View
          key={b.label}
          style={[s.badge, { backgroundColor: `${b.color}20` }]}
        >
          <Ionicons name={b.icon as any} size={10} color={b.color} />
          <Text style={[s.text, { color: b.color }]}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
};
