import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Gradients } from '@/theme';

interface GradientCoverProps {
  /** 渐变色标（左下 → 右上）。默认用品牌默认封面渐变。 */
  colors?: readonly string[];
  style?: StyleProp<ViewStyle>;
}

/**
 * 充满父容器的对角渐变背景（左下 → 右上），用作朋友圈 / 圈子封面在用户
 * 未上传图片时的默认底图。基于已安装的 react-native-svg，无需新增原生依赖；
 * 渐变以 objectBoundingBox 为单位随任意矩形拉伸铺满，分辨率无关。
 */
export function GradientCover({
  colors = Gradients.defaultCover,
  style,
}: GradientCoverProps) {
  // 同屏可能渲染多个封面（如圈子列表），用 useId 保证每个实例的渐变 id 唯一，
  // 避免 react-native-svg 跨 <Svg> 的 id 冲突。
  const gradientId = `cover-gradient-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const stops =
    colors.length >= 2 ? colors : [colors[0] ?? '#000000', colors[0] ?? '#000000'];
  const lastIndex = stops.length - 1;

  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            {stops.map((color, index) => (
              <Stop
                key={`${index}-${color}`}
                offset={index / lastIndex}
                stopColor={color}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}
