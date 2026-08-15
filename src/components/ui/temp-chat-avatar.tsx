import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { Radius } from '@/theme';

interface TempChatAvatarProps {
  size?: number;
  name?: string;
  /** 让角标外圈融入所在列表或标题栏的背景。 */
  badgeBorderColor?: string;
}

const FALLBACK_BADGE_BORDER = '#FFFFFF';

/**
 * 临时群聊的统一默认头像。
 *
 * 使用矢量渐变和群组轮廓，不依赖位图资源；右下角的小时钟是临时会话唯一的
 * 状态标识，在消息列表、搜索、转发选择器和聊天标题栏保持一致。
 */
export function TempChatAvatar({
  size = 40,
  name,
  badgeBorderColor = FALLBACK_BADGE_BORDER,
}: TempChatAvatarProps) {
  const gradientId = `temp-chat-avatar-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const badgeSize = Math.max(14, Math.round(size * 0.38));
  const badgeBorderWidth = Math.max(2, Math.round(size * 0.045));

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={name || undefined}
      style={{ width: size, height: size, position: 'relative' }}
    >
      <View
        style={[
          s.surface,
          {
            width: size,
            height: size,
            borderRadius: Radius.sm,
          },
        ]}
      >
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 48 48"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Defs>
            <LinearGradient id={gradientId} x1="5" y1="43" x2="43" y2="5">
              <Stop offset="0" stopColor="#5548D9" />
              <Stop offset="0.52" stopColor="#7467F5" />
              <Stop offset="1" stopColor="#A58BFF" />
            </LinearGradient>
          </Defs>
          <Rect width="48" height="48" rx="10" fill={`url(#${gradientId})`} />
          <Circle cx="8" cy="7" r="16" fill="#FFFFFF" opacity="0.09" />
          <Circle cx="43" cy="43" r="18" fill="#3427A8" opacity="0.16" />
          <Circle cx="24" cy="18" r="6" fill="#FFFFFF" opacity="0.98" />
          <Circle cx="13.5" cy="22" r="4.25" fill="#E5E1FF" opacity="0.9" />
          <Circle cx="34.5" cy="22" r="4.25" fill="#E5E1FF" opacity="0.9" />
          <Path
            d="M13.3 36.5c.7-7 5-11 10.7-11s10 4 10.7 11H13.3Z"
            fill="#FFFFFF"
            opacity="0.98"
          />
          <Path
            d="M5.5 35.5c.45-5.1 3.5-8.2 7.8-8.2 2 0 3.7.65 5.05 1.8-2.1 1.75-3.55 4.15-4.05 7.4H5.5v-1Z"
            fill="#E5E1FF"
            opacity="0.82"
          />
          <Path
            d="M42.5 35.5c-.45-5.1-3.5-8.2-7.8-8.2-2 0-3.7.65-5.05 1.8 2.1 1.75 3.55 4.15 4.05 7.4h8.8v-1Z"
            fill="#E5E1FF"
            opacity="0.82"
          />
        </Svg>
      </View>
      <View
        pointerEvents="none"
        style={[
          s.badge,
          {
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            borderWidth: badgeBorderWidth,
            borderColor: badgeBorderColor,
          },
        ]}
      >
        <Ionicons
          name="time-outline"
          size={Math.round(badgeSize * 0.58)}
          color="#FFFFFF"
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  surface: {
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  badge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4C3FD6',
  },
});
