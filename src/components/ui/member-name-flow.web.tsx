import { memo, useMemo } from 'react';
import { Text } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import type { MemberNameFlowProps } from './member-name-flow.types';

// Web 端没有加载 CanvasKit,沿用逐字插值。浏览器里 Reanimated 每帧直接改 DOM 样式,
// 只触发重绘、不经过 React 提交,没有原生端那种每帧整棵布局树重排的代价。

// 单个字符:颜色随全局 progress + 自身位置偏移在色带上循环流动,形成沿名字流走的光。
const FlowChar = memo(function FlowChar({
  char,
  colors,
  progress,
  offset,
}: {
  char: string;
  colors: readonly string[];
  progress: SharedValue<number>;
  offset: number;
}) {
  const inputRange = useMemo(
    () => colors.map((_, i) => i / (colors.length - 1)),
    [colors],
  );
  const animatedStyle = useAnimatedStyle(() => {
    const t = (progress.value + offset) % 1;
    return { color: interpolateColor(t, inputRange, colors as string[]) };
  });
  return <Animated.Text style={animatedStyle}>{char}</Animated.Text>;
});

export function MemberNameFlow({
  name,
  colors,
  progress,
  style,
  numberOfLines,
}: MemberNameFlowProps) {
  // Array.from 而非 split(''),正确切分 emoji / 代理对,避免半个字符染错色。
  const chars = useMemo(() => Array.from(name), [name]);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {chars.map((ch, index) => (
        <FlowChar
          key={`${index}-${ch}`}
          char={ch}
          colors={colors}
          progress={progress}
          offset={chars.length > 1 ? index / chars.length : 0}
        />
      ))}
    </Text>
  );
}
