import { useId, type RefObject } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { GlassSurface } from '@/components/ui/glass-surface';
import { type ThemeColors, withAlpha } from '@/theme';

/** 顶栏按钮与标题胶囊同高:44pt 是最小触控尺寸,三颗并排时上沿下沿对齐。 */
export const CHAT_HEADER_CONTROL_SIZE = 44;

/** 悬浮控件的描边与投影:比底部输入栏轻一档,顶部有渐隐托着,不需要那么重的影子。 */
export function chatHeaderFloatStyle(colors: ThemeColors, dark: boolean): ViewStyle {
  return {
    borderColor: withAlpha(colors.text, dark ? 0.12 : 0.08),
    boxShadow: `0 4px 12px ${withAlpha(colors.black, dark ? 0.24 : 0.08)}`,
  };
}

interface ChatHeaderGlassButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  floatStyle: ViewStyle;
  blurTarget?: RefObject<View | null>;
  testID?: string;
  /** 箭头类图标的视觉重心偏一侧,给一点反向位移让它在圆里看起来居中。 */
  iconStyle?: StyleProp<ViewStyle>;
}

/**
 * 顶栏两端的圆形玻璃按钮(返回 / 关闭 / 更多 / 展开)。
 * 按下只做缩放:GlassSurface 的祖先不能改 opacity,否则材质失效。
 */
export function ChatHeaderGlassButton({
  icon,
  label,
  onPress,
  colors,
  floatStyle,
  blurTarget,
  testID,
  iconStyle,
}: ChatHeaderGlassButtonProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => (pressed ? s.pressed : null)}
    >
      <GlassSurface
        material="banner"
        radius={CHAT_HEADER_CONTROL_SIZE / 2}
        blurTarget={blurTarget}
        style={[s.circle, floatStyle]}
      >
        <View style={iconStyle}>
          <Ionicons name={icon} size={22} color={colors.text} />
        </View>
      </GlassSurface>
    </Pressable>
  );
}

/** 按下时的回弹缩放,标题胶囊也用同一档。 */
export function chatHeaderPressedStyle(pressed: boolean) {
  return pressed ? s.pressed : null;
}

/**
 * 顶栏背后的渐隐:状态栏那一截用聊天底色盖实(时间、信号不和消息叠在一起),
 * 往下逐渐透明,消息从悬浮控件后面滑过时是慢慢淡出,而不是被一条直线切断。
 */
export function ChatHeaderFade({ color }: { color: string }) {
  const gradientId = `chat-header-fade-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View testID="chat-detail-header-fade" style={s.fade} pointerEvents="none">
      <Svg width="100%" height="100%" aria-hidden>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="0.45" stopColor={color} stopOpacity={0.88} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  circle: {
    width: CHAT_HEADER_CONTROL_SIZE,
    height: CHAT_HEADER_CONTROL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  pressed: { transform: [{ scale: 0.94 }] },
  // 比顶栏本身再往下延一截,渐隐收尾落在第一条消息上方而不是控件下沿。
  fade: { ...StyleSheet.absoluteFillObject, bottom: -16 },
});
