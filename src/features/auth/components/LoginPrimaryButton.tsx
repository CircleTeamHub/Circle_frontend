import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Radius, useTheme, withAlpha } from '@/theme';

interface LoginPrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

const s = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  button: {
    height: 52,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dimmed: {
    opacity: 0.6,
  },
  // 暗色按钮顶边一道 1px 高光，做出"有厚度"的玻璃感（RN 没有内阴影）。
  hairline: {
    position: 'absolute',
    top: 0,
    left: Radius.md,
    right: Radius.md,
    height: 1,
  },
  // 安卓没有彩色阴影，用两层半透明色板铺在按钮下面模拟光晕。
  plateInner: {
    position: 'absolute',
    left: -4,
    right: -4,
    top: 6,
    bottom: -6,
    borderRadius: Radius.md + 4,
  },
  plateOuter: {
    position: 'absolute',
    left: -10,
    right: -10,
    top: 6,
    bottom: -10,
    borderRadius: Radius.md + 10,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
});

/**
 * 登录页主按钮：夜航里"唯一的光源"。
 * iOS / web 用品牌色阴影发光；安卓退化为两层半透明色板；亮色主题光更弱，读作抬起而不是发光。
 */
export function LoginPrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  testID,
}: LoginPrimaryButtonProps) {
  const { colors, resolvedMode } = useTheme();
  const dark = resolvedMode === 'dark';
  const glow = dark ? 1 : 0.55;
  const useShadow = Platform.OS !== 'android';
  const shadow = useShadow
    ? {
        shadowColor: colors.primary,
        shadowOpacity: 0.45 * glow,
        shadowRadius: dark ? 16 : 12,
        shadowOffset: { width: 0, height: 6 },
      }
    : null;

  return (
    <View style={s.wrap}>
      {useShadow ? null : (
        <>
          <View
            pointerEvents="none"
            style={[s.plateOuter, { backgroundColor: withAlpha(colors.primary, 0.12 * glow) }]}
          />
          <View
            pointerEvents="none"
            style={[s.plateInner, { backgroundColor: withAlpha(colors.primary, 0.25 * glow) }]}
          />
        </>
      )}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: loading }}
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          s.button,
          shadow,
          { backgroundColor: pressed ? colors.primaryDeep : colors.primary },
          disabled && !loading && s.dimmed,
        ]}
      >
        {dark ? (
          <View
            pointerEvents="none"
            style={[s.hairline, { backgroundColor: withAlpha(colors.white, 0.18) }]}
          />
        ) : null}
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={[s.label, { color: colors.white }]}>{label}</Text>
        )}
      </Pressable>
    </View>
  );
}
