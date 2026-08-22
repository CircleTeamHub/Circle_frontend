import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { Radius } from '@/theme';

interface GroupChatAvatarProps {
  size?: number;
  name?: string;
  uri?: string | null;
  /** 临时群聊额外显示金色时钟角标；普通群聊不显示。 */
  temporary?: boolean;
  /** 让临时角标外圈融入所在列表或标题栏的背景。 */
  badgeBorderColor?: string;
}

const FALLBACK_BADGE_BORDER = '#FFFFFF';

/**
 * 群聊统一头像：已有头像时优先显示图片；未设置时回落到品牌紫渐变群组图形。
 * 临时群聊复用同一底图，仅通过右下角金色时钟表达临时属性。
 */
export function GroupChatAvatar({
  size = 40,
  name,
  uri,
  temporary = false,
  badgeBorderColor = FALLBACK_BADGE_BORDER,
}: GroupChatAvatarProps) {
  const gradientId = `group-chat-avatar-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
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
        {uri && uri.length > 0 ? (
          <Image
            source={{ uri }}
            recyclingKey={uri}
            contentFit="cover"
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 48 48"
            pointerEvents="none"
            // 同 avatar.tsx：aria-hidden 是跨平台别名，web 上不会把 RN 专属
            // a11y prop 泄进 DOM。
            aria-hidden
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
        )}
      </View>
      {temporary ? (
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
            color="#5A3600"
          />
        </View>
      ) : null}
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
    backgroundColor: '#FFC857',
  },
});
