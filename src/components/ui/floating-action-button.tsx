import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface FloatingActionButtonProps {
  onPress: () => void;
  /** 胶囊里显示的文字；同时作为无障碍标签。 */
  label: string;
  /** 不传时画卡通风格的胖「+」（Ionicons 的 add 笔画太细）。 */
  icon?: keyof typeof Ionicons.glyphMap;
  /** 由父层给出 bottom（通常 = 安全区 + 间距），按钮固定贴右下角。 */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const PLUS_SIZE = 22;

/**
 * 右下角悬浮主操作：图标 + 文字的实心胶囊，纯色、柔和投影、按下轻微缩小。
 * 比单个圆钮更直白地说明「点了做什么」。
 */
export function FloatingActionButton({
  onPress,
  label,
  icon,
  style,
  testID,
}: FloatingActionButtonProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={8}
      style={({ pressed }) => [
        s.button,
        { backgroundColor: colors.primary, shadowColor: colors.primary },
        pressed ? s.pressed : null,
        style,
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={20} color={colors.white} />
      ) : (
        <Svg width={PLUS_SIZE} height={PLUS_SIZE} viewBox="0 0 24 24">
          {/* 卡通加号：短而胖的圆头十字，右上角缀一颗小闪光。 */}
          <Path
            d="M11 6.5v12M5 12.5h12"
            stroke={colors.white}
            strokeWidth={4.6}
            strokeLinecap="round"
          />
          <Path
            d="M20 1.5c.35 1.5.9 2.05 2.4 2.4-1.5.35-2.05.9-2.4 2.4-.35-1.5-.9-2.05-2.4-2.4 1.5-.35 2.05-.9 2.4-2.4z"
            fill={colors.white}
            stroke={colors.white}
            strokeWidth={0.8}
            strokeLinejoin="round"
          />
        </Svg>
      )}
      <Text style={[s.label, { color: colors.white }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: {
    position: 'absolute',
    right: Spacing.lg,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.lg - 4,
    borderRadius: Radius.full,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  label: {
    ...Typography.body,
    fontWeight: '600',
  },
  pressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.92,
  },
});
