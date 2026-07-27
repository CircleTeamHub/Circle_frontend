import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { UserIconBadge } from '@/components/ui/user-icon-row';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { BadgeView } from '@/features/profile/badge-catalog';

interface BadgeDetailSheetProps {
  badge: BadgeView | null;
  /** 该徽章当前是否在资料展示位（仅已拥有可能为 true）。 */
  selected: boolean;
  onToggleDisplay: (badge: BadgeView) => void;
  onClose: () => void;
}

// VIP 徽章按当前档位（silver/gold/diamond/super）展示不同文案；其余徽章用类型级说明。
function explainKeys(badge: BadgeView): { description: string; condition: string } {
  if (badge.tierKey) {
    return {
      description: `myIcons.explain.vip.tiers.${badge.tierKey}.description`,
      condition: `myIcons.explain.vip.tiers.${badge.tierKey}.condition`,
    };
  }
  return {
    description: `myIcons.explain.${badge.explainKey}.description`,
    condition: `myIcons.explain.${badge.explainKey}.condition`,
  };
}

const s = StyleSheet.create({
  card: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.full,
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  heroBadge: {
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locked: {
    opacity: 0.4,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroTitle: {
    ...Typography.h2,
    fontWeight: '700',
    textAlign: 'center',
  },
  copyGroup: {
    gap: Spacing.xs,
  },
  label: {
    ...Typography.small,
    fontWeight: '700',
  },
  body: {
    ...Typography.body,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  primaryButtonText: {
    ...Typography.body,
    fontWeight: '700',
  },
  closeButton: {
    minHeight: 44,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    ...Typography.body,
    fontWeight: '600',
  },
});

export function BadgeDetailSheet({
  badge,
  selected,
  onToggleDisplay,
  onClose,
}: BadgeDetailSheetProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <BottomSheetModal
      visible={Boolean(badge)}
      onClose={onClose}
      backdropStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.55)' }}
    >
      {badge ? (
        <View
          style={[
            s.card,
            {
              backgroundColor: colors.surface,
              paddingBottom: insets.bottom + Spacing.lg,
            },
          ]}
        >
          <View style={[s.grabber, { backgroundColor: colors.surfaceBorder }]} />

          <View style={s.hero}>
            <View style={[s.heroBadge, badge.owned ? null : s.locked]}>
              <UserIconBadge icon={badge.previewIcon} size={72} />
            </View>
            <View style={s.heroTitleRow}>
              {badge.owned ? null : (
                <Ionicons
                  name="lock-closed"
                  size={16}
                  color={colors.textSecondary}
                />
              )}
              <Text style={[s.heroTitle, { color: colors.text }]}>
                {badge.title}
              </Text>
            </View>
          </View>

          <View style={s.copyGroup}>
            <Text style={[s.label, { color: colors.text }]}>
              {t('myIcons.explainIntroLabel', { defaultValue: '介绍' })}
            </Text>
            <Text style={[s.body, { color: colors.textSecondary }]}>
              {t(explainKeys(badge).description)}
            </Text>
          </View>

          <View style={s.copyGroup}>
            <Text style={[s.label, { color: colors.text }]}>
              {t('myIcons.explainConditionLabel', { defaultValue: '获得条件' })}
            </Text>
            <Text style={[s.body, { color: colors.textSecondary }]}>
              {t(explainKeys(badge).condition)}
            </Text>
          </View>

          {badge.owned ? (
            <Pressable
              style={[
                s.primaryButton,
                {
                  backgroundColor: selected ? colors.surface : colors.primary,
                  borderWidth: selected ? 1 : 0,
                  borderColor: colors.surfaceBorder,
                },
              ]}
              onPress={() => onToggleDisplay(badge)}
            >
              <Ionicons
                name={selected ? 'remove-circle-outline' : 'add-circle-outline'}
                size={18}
                color={selected ? colors.textSecondary : colors.white}
              />
              <Text
                style={[
                  s.primaryButtonText,
                  { color: selected ? colors.textSecondary : colors.white },
                ]}
              >
                {selected
                  ? t('myIcons.removeFromDisplay', { defaultValue: '取消展示' })
                  : t('myIcons.addToDisplay', { defaultValue: '在资料展示' })}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            style={[s.closeButton, { backgroundColor: colors.background }]}
            onPress={onClose}
          >
            <Text style={[s.closeButtonText, { color: colors.textSecondary }]}>
              {t('myIcons.close', { defaultValue: '关闭' })}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </BottomSheetModal>
  );
}
