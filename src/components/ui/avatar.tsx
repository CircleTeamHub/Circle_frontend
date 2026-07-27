import { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  type ImageSourcePropType,
} from 'react-native';
import { Image } from 'expo-image';
import { useTheme, Radius } from '@/theme';
import {
  AVATAR_FRAME_SCALE,
  AVATAR_FRAME_COMPACT_SCALE,
} from '@/features/profile/membership-frames';

interface AvatarProps {
  size?: number;
  name?: string;
  uri?: string;
  bgColor?: string;
  shape?: 'circle' | 'square';
  /**
   * 头像框(如会员框):透明 PNG,内孔占画布 1/AVATAR_FRAME_SCALE。仅圆形头像生效
   * (框素材是圆形的,方形头像不适用)。框在自身占位盒内居中铺满,不负偏移溢出、不会被裁切。
   */
  frameSource?: ImageSourcePropType;
  /**
   * 头像框相对 size 的紧凑度:
   * - false(默认):框在 size 外扩 —— 总占位 = size × 1.6,照片 = size(资料页,头像整体更大)。
   * - true:紧凑模式 —— 总占位 = size × 1.2(AVATAR_FRAME_COMPACT_SCALE),照片 = size × 0.75。
   *   带框头像只比同处普通头像略大一点、不喧宾夺主(聊天 / 朋友圈列表用)。
   */
  compactFrame?: boolean;
}

const s = StyleSheet.create({
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  frameWrap: {
    // 锚点 + 居中头像:按框尺寸(frameSize)预留占位,框铺满容器、不溢出裁切。
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export const Avatar: React.FC<AvatarProps> = ({
  size = 40,
  name,
  uri,
  bgColor,
  shape = 'circle',
  frameSource,
  compactFrame = false,
}) => {
  const { colors } = useTheme();
  const resolvedBgColor = bgColor ?? colors.primary;
  const hasFrame = Boolean(frameSource) && shape === 'circle';
  // frameSize = 整体占位(框铺满它);photoSize = 里面的照片(填内孔)。紧凑模式框=size×1.2、照片=size×0.75;
  // 默认外扩框=size×1.6、照片=size。非会员无框时 photoSize=size。
  const frameSize =
    size *
    (hasFrame && compactFrame ? AVATAR_FRAME_COMPACT_SCALE : AVATAR_FRAME_SCALE);
  const photoSize = hasFrame ? frameSize / AVATAR_FRAME_SCALE : size;
  const borderRadius = shape === 'square' ? Radius.sm : photoSize / 2;

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
        style={[d.image, { width: photoSize, height: photoSize, borderRadius }]}
      />
    ) : (
      <View
        style={[
          s.fallback,
          { width: photoSize, height: photoSize, borderRadius, backgroundColor: resolvedBgColor },
        ]}
      >
        {/* `name && name[0]` 在空字符串时为 '',用 `||` 兜底成 '?',避免渲染空 initial。 */}
        <Text style={[d.initial, { fontSize: photoSize * 0.4 }]}>
          {(name && name[0]) || '?'}
        </Text>
      </View>
    );

  if (!frameSource || shape !== 'circle') {
    return core;
  }

  // 框在自身占位盒(frameSize)内居中铺满 —— top/left:0,不负偏移,永远完整绘制,不被卡片顶 / 屏幕边裁掉。
  return (
    <View style={[s.frameWrap, { width: frameSize, height: frameSize }]}>
      {core}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: frameSize,
          height: frameSize,
        }}
      >
        <Image source={frameSource} style={{ width: '100%', height: '100%' }} />
      </View>
    </View>
  );
};
