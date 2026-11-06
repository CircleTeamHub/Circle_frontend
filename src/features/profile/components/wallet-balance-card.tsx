import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { PlaneLogoIcon } from '@/components/app/plane-logo-icon';
import { Gradients, Radius, Spacing, useTheme, withAlpha } from '@/theme';
import { getLocalizedDateTimeLocale } from '@/utils/locale';

const [GOLD_LIGHT, GOLD] = Gradients.goldFoil;
// 卡面画布：ISO 7810 ID-1 比例（85.6×54mm ≈ 1.586），随卡面拉伸。
const CARD_W = 400;
const CARD_H = 252;

// 防伪底纹（guilloche）：一组相位错开的细波浪线，只铺在卡面右半边，向左渐隐。
const GUILLOCHE_PATHS = Array.from({ length: 14 }, (_, i) => {
  const y = 40 + i * 14;
  const amp = 10 + (i % 3) * 3;
  const phase = (i % 4) * 25;
  let d = `M${120 + phase - 100} ${y}`;
  for (let x = 120 + phase - 100; x < CARD_W + 100; x += 100) {
    d += ` Q${x + 25} ${y - amp} ${x + 50} ${y} T${x + 100} ${y}`;
  }
  return d;
});

const s = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    aspectRatio: CARD_W / CARD_H,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    borderWidth: 1,
    padding: Spacing.lg,
    justifyContent: 'space-between',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 30,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brand: {
    fontSize: 16,
    fontWeight: '700',
    fontStyle: 'italic',
    letterSpacing: 0.6,
  },
  balanceBlock: {
    gap: 2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  balance: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  // 压印卡号：金色字 + 下方一道暗影，像实体卡上凸起的烫金数字。
  cardNumber: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 3,
    fontVariant: ['tabular-nums'],
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  holder: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
    flexShrink: 1,
    textAlign: 'right',
  },
});

interface WalletBalanceCardProps {
  balance: number;
  loading: boolean;
  accountId: string;
  holder: string;
}

/** 钱包积分卡：黑金信用卡质感，余额可一键隐藏。 */
export function WalletBalanceCard({ balance, loading, accountId, holder }: WalletBalanceCardProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  // 公共场合打开钱包时一键遮住余额，和银行 App 的「小眼睛」一样，只在本次打开内有效。
  const [hidden, setHidden] = useState(false);
  const formattedBalance = new Intl.NumberFormat(
    getLocalizedDateTimeLocale(i18n.language),
  ).format(balance);

  return (
    <View
      testID="wallet-balance-card"
      style={[s.card, { borderColor: withAlpha(GOLD, 0.55), shadowColor: colors.black }]}
    >
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox={`0 0 ${CARD_W} ${CARD_H}`}
        preserveAspectRatio="none"
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="cardBase" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={Gradients.blackCard[0]} />
            <Stop offset="0.45" stopColor={Gradients.blackCard[1]} />
            <Stop offset="1" stopColor={Gradients.blackCard[2]} />
          </LinearGradient>
          <LinearGradient id="guilloche" gradientUnits="userSpaceOnUse" x1={CARD_W} y1="0" x2="140" y2={CARD_H}>
            <Stop offset="0" stopColor={GOLD} stopOpacity={0.22} />
            <Stop offset="1" stopColor={GOLD} stopOpacity={0} />
          </LinearGradient>
          {/* 斜向一道金属反光。 */}
          <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0.25" stopColor={colors.white} stopOpacity={0} />
            <Stop offset="0.45" stopColor={colors.white} stopOpacity={0.09} />
            <Stop offset="0.6" stopColor={colors.white} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width={CARD_W} height={CARD_H} fill="url(#cardBase)" />
        <G fill="none" stroke="url(#guilloche)" strokeWidth={0.8}>
          {GUILLOCHE_PATHS.map((d) => (
            <Path key={d} d={d} />
          ))}
        </G>
        <Rect width={CARD_W} height={CARD_H} fill="url(#sheen)" />
      </Svg>

      <View style={s.topRow}>
        <View style={s.brandRow}>
          <PlaneLogoIcon size={18} color={GOLD} filled />
          <Text style={[s.brand, { color: GOLD }]}>WindNote</Text>
        </View>
      </View>

      <View style={s.balanceBlock}>
        <View style={s.labelRow}>
          <Text style={[s.label, { color: withAlpha(colors.white, 0.6) }]}>
            {t('profile.wallet.balance', { defaultValue: '积分余额' })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              hidden
                ? t('profile.wallet.showBalance', { defaultValue: '显示余额' })
                : t('profile.wallet.hideBalance', { defaultValue: '隐藏余额' })
            }
            hitSlop={10}
            onPress={() => setHidden((value) => !value)}
          >
            <Ionicons
              name={hidden ? 'eye-off-outline' : 'eye-outline'}
              size={16}
              color={withAlpha(GOLD, 0.85)}
            />
          </Pressable>
        </View>
        <Text style={[s.balance, { color: GOLD_LIGHT }]} selectable={!hidden}>
          {loading ? '...' : hidden ? '••••••' : formattedBalance}
        </Text>
      </View>

      <View style={s.bottomRow}>
        <Text style={[s.cardNumber, { color: GOLD, textShadowColor: withAlpha(colors.black, 0.7) }]}>
          {accountId}
        </Text>
        <Text style={[s.holder, { color: withAlpha(colors.white, 0.75) }]} numberOfLines={1}>
          {holder}
        </Text>
      </View>
    </View>
  );
}
