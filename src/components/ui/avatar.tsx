import { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  type ImageSourcePropType,
} from 'react-native';
import { Image } from 'expo-image';
import { useTheme, Radius } from '@/theme';
import { AVATAR_FRAME_SCALE } from '@/features/profile/membership-frames';

interface AvatarProps {
  size?: number;
  name?: string;
  uri?: string;
  bgColor?: string;
  shape?: 'circle' | 'square';
  /**
   * 头像框(如会员框):透明 PNG,内孔占画布 1/AVATAR_FRAME_SCALE,按比例放大后
   * 居中叠在头像上。仅圆形头像生效——框素材是圆形的,方形头像(聊天列表)不适用。
   * 叠层不改变布局占位(仍是 size×size),外圈溢出部分绘制在布局框外。
   */
  frameSource?: ImageSourcePropType;
}

const s = StyleSheet.create({
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  frameWrap: {
    // 子元素绝对定位的锚点;本身不裁剪,让框的外圈溢出可见。
    position: 'relative',
  },
});

export const Avatar: React.FC<AvatarProps> = ({
  size = 40,
  name,
  uri,
  bgColor,
  shape = 'circle',
  frameSource,
}) => {
  const { colors } = useTheme();
  const resolvedBgColor = bgColor ?? colors.primary;
  const borderRadius = shape === 'square' ? Radius.sm : size / 2;

  const d = useMemo(
    () => ({
      image: {
        backgroundColor: colors.surface,
      },
      initial: {
        color: colors.white,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  // 空字符串的 uri 也走 fallback —— `<Image source={{ uri: '' }} />` 直接渲染空白。
  const core =
    uri && uri.length > 0 ? (
      <Image
        source={{ uri }}
        recyclingKey={uri}
        style={[d.image, { width: size, height: size, borderRadius }]}
      />
    ) : (
      <View
        style={[
          s.fallback,
          { width: size, height: size, borderRadius, backgroundColor: resolvedBgColor },
        ]}
      >
        {/* `name?.charAt(0) ?? '?'` 在 name 为空字符串时返回 ''(charAt 不返回 undefined),
            渲染出一个空 initial。改用 `||` 兜底。 */}
        <Text style={[d.initial, { fontSize: size * 0.4 }]}>
          {(name && name[0]) || '?'}
        </Text>
      </View>
    );

  if (!frameSource || shape !== 'circle') {
    return core;
  }

  const frameSize = size * AVATAR_FRAME_SCALE;
  const frameOffset = -(frameSize - size) / 2;
  return (
    <View style={[s.frameWrap, { width: size, height: size }]}>
      {core}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: frameOffset,
          left: frameOffset,
          width: frameSize,
          height: frameSize,
        }}
      >
        <Image source={frameSource} style={{ width: '100%', height: '100%' }} />
      </View>
    </View>
  );
};
