import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { GradientCover } from '@/components/ui/gradient-cover';

interface CircleAvatarProps {
  /** 圈子头像 URL；为空时回落到品牌渐变默认头像。 */
  uri?: string | null;
  size: number;
  /** 圆角，默认圆形（size/2）。方形头像传 Radius.sm/md 等。 */
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

// 渐变中部偏亮（淡紫），居中字形用深紫罗兰而非白色，保证对比度。
const GLYPH_COLOR = 'rgba(70,58,140,0.7)';

/**
 * 圈子头像：有图显示图片；无图时回落到「品牌渐变底 + 居中 people 字形」的
 * 默认头像，与朋友圈 / 圈子封面的默认渐变保持同一视觉语言。基于已装的
 * react-native-svg（经 GradientCover），无需新增原生依赖或图片资源。
 */
export function CircleAvatar({
  uri,
  size,
  borderRadius,
  style,
}: CircleAvatarProps) {
  const radius = borderRadius ?? size / 2;
  // overflow:hidden 把方形图片 / 渐变裁成圆角形状。
  const container = {
    width: size,
    height: size,
    borderRadius: radius,
    overflow: 'hidden' as const,
  };

  if (uri && uri.length > 0) {
    return (
      <View style={[container, style]}>
        <Image
          source={{ uri }}
          recyclingKey={uri}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      </View>
    );
  }

  return (
    <View
      style={[
        container,
        { alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      <GradientCover />
      <Ionicons name="people" size={Math.round(size * 0.5)} color={GLYPH_COLOR} />
    </View>
  );
}
