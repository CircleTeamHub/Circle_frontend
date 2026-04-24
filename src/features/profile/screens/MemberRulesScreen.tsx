import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const RULES = [
  'VIP1-5 按会员等级逐级解锁权益，当前页面仅展示等级与权益说明。',
  '高等级会员可获得更多群容量、靓号折扣、积分加成和优先体验资格。',
  '会员兑换消耗积分，兑换后立即生效；具体有效期以后端订单为准。',
  '会员、靓号、群扩容卡等虚拟商品一经使用不可撤销。',
];

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  rule: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginTop: 6,
  },
  ruleText: {
    flex: 1,
  },
});

export default function MemberRulesScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      },
      content: {
        paddingBottom: insets.bottom + Spacing.xl,
      },
      title: {
        color: colors.text,
        ...Typography.h1,
      },
      desc: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        lineHeight: 22,
      },
      card: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      dot: {
        backgroundColor: colors.primary,
      },
      ruleText: {
        color: colors.text,
        ...Typography.bodyRegular,
        lineHeight: 22,
      },
    }),
    [colors, insets.bottom, insets.top],
  );

  return (
    <View style={d.container}>
      <NavHeader title="规则和权限说明" />
      <ScrollView contentContainerStyle={[s.content, d.content]}>
        <Text style={d.title}>会员规则</Text>
        <Text style={d.desc}>
          以下规则用于说明会员等级、积分兑换和权限范围。支付、订单和有效期将在后续接入真实后端。
        </Text>
        <View style={[s.card, d.card]}>
          {RULES.map((rule) => (
            <View key={rule} style={s.rule}>
              <View style={[s.dot, d.dot]} />
              <Text style={[s.ruleText, d.ruleText]}>{rule}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
