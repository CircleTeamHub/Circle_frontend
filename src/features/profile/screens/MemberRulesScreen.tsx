import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const RULES = [
  {
    key: 'profile.memberRules.rules.catalog',
    defaultValue:
      '白银会员 ¥298 / 1 个月；黄金会员 ¥1288 / 6 个月；钻石会员 ¥1998 / 1 年；超级会员 ¥3998 / 永久。',
  },
  {
    key: 'profile.memberRules.rules.supportActivation',
    defaultValue:
      '会员不在 App 内使用积分兑换或直接购买。联系客服后，由客服人工核实并开通会员。',
  },
  {
    key: 'profile.memberRules.rules.upgrade',
    defaultValue:
      '已开通会员可联系客服补差价升级；升级后立即生效，原会员剩余价值由客服核算抵扣。',
  },
  {
    key: 'profile.memberRules.rules.expiry',
    defaultValue:
      '会员到期后仅停止会员权益，不删除账号、聊天、笔记或其他用户内容。',
  },
  {
    key: 'profile.memberRules.rules.fairUse',
    defaultValue:
      '页面展示的“不限”仍受后端较高的合理使用与防滥用上限约束，实际权限以后端为准。',
  },
  {
    key: 'profile.memberRules.rules.voiceToText',
    defaultValue:
      '语音转文字是所有用户可用的免费基础功能，不受会员等级限制。',
  },
  {
    key: 'profile.memberRules.rules.excludedVisualBenefits',
    defaultValue: '当前会员权益不包含头像框或动态头像承诺。',
  },
] as const;

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  card: {
    borderRadius: Radius.sm,
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
    flexShrink: 1,
  },
});

export default function MemberRulesScreen() {
  const { t } = useTranslation();
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
      <NavHeader title={t('profile.memberRules.title', { defaultValue: '规则和权限说明' })} />
      <ScrollView contentContainerStyle={[s.content, d.content]}>
        <Text style={d.title}>
          {t('profile.memberRules.heading', { defaultValue: '会员规则' })}
        </Text>
        <Text style={d.desc}>
          {t('profile.memberRules.description', {
            defaultValue:
              '会员由客服人工核实并开通，页面展示权益目录，实际权限以后端为准。',
          })}
        </Text>
        <View style={[s.card, d.card]}>
          {RULES.map((rule) => (
            <View key={rule.key} style={s.rule}>
              <View style={[s.dot, d.dot]} />
              <Text style={[s.ruleText, d.ruleText]}>
                {t(rule.key, { defaultValue: rule.defaultValue })}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
