import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type LayoutRectangle,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextLayoutEventData,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  Canvas,
  LinearGradient,
  Mask,
  Paragraph,
  Rect,
  Skia,
  TextAlign,
  vec,
  type FontWeight,
  type SkParagraph,
  type SkParagraphStyle,
  type SkTextStyle,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { reportHandledFailure } from '@/observability/report-failure';
import type { MemberNameFlowProps } from './member-name-flow.types';

// 原生端的流光由 Skia 在 UI 线程直接画:时钟走一帧,只有渐变的起止点(派生值)变,
// 不经过 React、不提交布局树、不重排文字。旧实现逐字用 Reanimated 动画样式改文字颜色,
// 每帧都要整段文字重新测量 —— 顶档会员名一在屏幕上手机就发烫。
//
// 原生 Text 仍然留着,负责排版占位和读屏朗读;Skia 画布按它的框叠上去,画好之后
// 占位字变透明。字号以原生实测的行宽为准对齐,而不是自己按 fontScale 换算 ——
// Android 14 起大字号是非线性缩放的,JS 拿到的 fontScale 却是线性的。

const DEFAULT_FONT_SIZE = 14;
const ELLIPSIS = '…';
/** Skia 与原生排版宽度差在 1% 以内就不再重排,免得为亚像素差异多建一次段落。 */
const FIT_TOLERANCE = 0.01;
/** 两边宽度只差亚像素时,留 1pt 余量,免得最后一个字被挤到第二行。 */
const LAYOUT_SLACK = 1;

// iOS 的系统字体在 CoreText 里叫 .AppleSystemUIFont(和 RN 默认字体同一套 SF);
// SF 不含汉字,把苹方显式排在后面,中文名字才和原生 Text 落在同一款字体上。
// Android 的 sans-serif 就是 RN 默认的 Roboto,中日韩由系统回退到 Noto。
const SYSTEM_FONT_FAMILIES =
  Platform.OS === 'ios' ? ['.AppleSystemUIFont', 'PingFang SC'] : ['sans-serif'];

const NAMED_WEIGHTS: Record<string, number> = {
  ultralight: 100,
  thin: 100,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  condensedBold: 700,
  heavy: 800,
  black: 900,
};

const TEXT_ALIGN: Partial<Record<NonNullable<TextStyle['textAlign']>, TextAlign>> = {
  left: TextAlign.Left,
  right: TextAlign.Right,
  center: TextAlign.Center,
  justify: TextAlign.Justify,
};

// 只有字形相关的属性留给占位 Text 和 Skia;盒子相关的(内外边距、边框、底色、透明度、
// 变换、尺寸、定位、flex)一律归外层容器。占位 Text 的框必须恰好就是文字本身,
// Skia 画布才能按它的 x/y/宽高原样叠上去。
const CONTAINER_KEY =
  /^(margin|padding|border|flex|min|max)|^(alignSelf|position|top|bottom|left|right|start|end|zIndex|width|height|backgroundColor|opacity|transform|overflow)$/;

function splitStyle(style: StyleProp<TextStyle>): {
  container: ViewStyle;
  text: TextStyle;
} {
  const flat = StyleSheet.flatten(style) ?? {};
  const container: Record<string, unknown> = {};
  const text: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (CONTAINER_KEY.test(key)) {
      container[key] = value;
    } else {
      text[key] = value;
    }
  }
  return { container: container as ViewStyle, text: text as TextStyle };
}

function toSkiaWeight(weight: TextStyle['fontWeight']): FontWeight {
  if (typeof weight === 'number') {
    return weight as FontWeight;
  }
  const numeric = Number(weight);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric as FontWeight;
  }
  return (NAMED_WEIGHTS[weight ?? 'normal'] ?? 400) as FontWeight;
}

interface FlowTypography {
  /** 已乘系统字号倍率的名义字号;实际绘制还要再乘对齐系数。 */
  fontSize: number;
  fontWeight: FontWeight;
  textAlign: TextAlign;
  letterSpacing?: number;
  lineHeight?: number;
}

/** 原生实测的排版结果:各行宽度之和,以及名字有没有被截断(省略号)。 */
interface MeasuredText {
  width: number;
  complete: boolean;
}

// JSI 侧按「有没有这个键」取值,键在但值是 undefined 会直接抛错 ——
// 可选项一律按需展开,不能写成 `maxLines: undefined`。
function buildParagraph(
  name: string,
  typography: FlowTypography,
  fit: number,
  numberOfLines: number | undefined,
  width: number,
): SkParagraph {
  const paragraphStyle: SkParagraphStyle = {
    textAlign: typography.textAlign,
    ...(numberOfLines ? { maxLines: numberOfLines, ellipsis: ELLIPSIS } : {}),
  };
  const textStyle: SkTextStyle = {
    // 颜色无所谓:段落只当遮罩用,真正的颜色来自渐变。
    color: Skia.Color('black'),
    fontSize: typography.fontSize * fit,
    fontFamilies: SYSTEM_FONT_FAMILIES,
    fontStyle: { weight: typography.fontWeight },
    ...(typography.letterSpacing != null
      ? { letterSpacing: typography.letterSpacing }
      : {}),
    ...(typography.lineHeight
      ? {
          heightMultiplier: typography.lineHeight / typography.fontSize,
          halfLeading: true,
        }
      : {}),
  };
  const paragraph = Skia.ParagraphBuilder.Make(paragraphStyle)
    .pushStyle(textStyle)
    .addText(name)
    .build();
  paragraph.layout(width);
  return paragraph;
}

/**
 * 让 Skia 的字宽对上原生实测宽度。名字被截断时没法比(原生量到的是截断后的宽度),
 * 保持名义字号,截断交给 Skia 自己的省略号。
 */
function fitFactor(measured: MeasuredText | null, intrinsicWidth: number): number {
  if (!measured?.complete || measured.width <= 0 || intrinsicWidth <= 0) {
    return 1;
  }
  const factor = measured.width / intrinsicWidth;
  return Math.abs(factor - 1) > FIT_TOLERANCE ? factor : 1;
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

function sameFrame(a: LayoutRectangle, b: LayoutRectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

type ParagraphResult =
  | { paragraph: SkParagraph; error: null }
  | { paragraph: null; error: unknown };

export function MemberNameFlow({
  name,
  colors,
  progress,
  style,
  numberOfLines,
}: MemberNameFlowProps) {
  const { fontScale } = useWindowDimensions();
  const { container, text } = useMemo(() => splitStyle(style), [style]);
  const gradientColors = useMemo(() => [...colors], [colors]);
  const [frame, setFrame] = useState<LayoutRectangle | null>(null);
  const [measured, setMeasured] = useState<MeasuredText | null>(null);

  // 以原始值作依赖:调用处传内联样式时,不至于每次渲染都重建段落。
  const { fontSize, fontWeight, textAlign, letterSpacing, lineHeight } = text;
  const typography = useMemo<FlowTypography>(
    () => ({
      fontSize: (fontSize ?? DEFAULT_FONT_SIZE) * fontScale,
      fontWeight: toSkiaWeight(fontWeight),
      textAlign: TEXT_ALIGN[textAlign ?? 'left'] ?? TextAlign.Left,
      ...(letterSpacing != null ? { letterSpacing } : {}),
      ...(lineHeight ? { lineHeight: lineHeight * fontScale } : {}),
    }),
    [fontScale, fontSize, fontWeight, letterSpacing, lineHeight, textAlign],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    setFrame((prev) => (prev && sameFrame(prev, next) ? prev : next));
  }, []);

  const handleTextLayout = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      const { lines } = event.nativeEvent;
      const next: MeasuredText = {
        width: lines.reduce((sum, line) => sum + line.width, 0),
        complete: compact(lines.map((line) => line.text).join('')) === compact(name),
      };
      setMeasured((prev) =>
        prev && prev.width === next.width && prev.complete === next.complete
          ? prev
          : next,
      );
    },
    [name],
  );

  const result = useMemo<ParagraphResult | null>(() => {
    if (!frame || frame.width <= 0) {
      return null;
    }
    const layoutWidth = frame.width + LAYOUT_SLACK;
    try {
      const nominal = buildParagraph(name, typography, 1, numberOfLines, layoutWidth);
      const fit = fitFactor(measured, nominal.getMaxIntrinsicWidth());
      const paragraph =
        fit === 1
          ? nominal
          : buildParagraph(name, typography, fit, numberOfLines, layoutWidth);
      return { paragraph, error: null };
    } catch (error) {
      return { paragraph: null, error };
    }
  }, [frame, measured, name, numberOfLines, typography]);

  useEffect(() => {
    if (result?.error) {
      // 画不出来时占位字保持可见(色带首色),名字不会消失;只上报,不打断页面。
      reportHandledFailure('memberName', 'skiaParagraph', result.error);
    }
  }, [result]);

  const paragraph = result?.paragraph ?? null;

  // 一圈(progress 0→1)恰好平移一个文字宽度,配合 repeat 平铺 + 回文色带,循环无缝。
  // 色带随时间向左流,与旧版逐字插值的方向一致。
  const period = paragraph ? Math.max(paragraph.getLongestLine(), 1) : 1;
  const gradientStart = useDerivedValue(() => vec(-progress.value * period, 0));
  const gradientEnd = useDerivedValue(() => vec((1 - progress.value) * period, 0));

  // 画布就绪前占位字用色带首色显示,避免名字在首帧空白。
  const placeholderInk = useMemo(
    () => (paragraph ? s.inkHidden : { color: colors[0] }),
    [colors, paragraph],
  );

  return (
    <View style={container}>
      <Text
        style={[text, placeholderInk]}
        numberOfLines={numberOfLines}
        onLayout={handleLayout}
        onTextLayout={handleTextLayout}
      >
        {name}
      </Text>
      {frame && paragraph ? (
        <Canvas
          style={[
            s.canvas,
            { left: frame.x, top: frame.y, width: frame.width, height: frame.height },
          ]}
          // 色带是 sRGB 色值;默认的 P3 画布会把它们当 P3 解释,比同色的原生文字更艳。
          colorSpace="srgb"
          pointerEvents="none"
        >
          {/* 渐变矩形本身就铺满画布,不需要 Mask 再按遮罩裁一遍(clip 会把子节点画两次)。 */}
          <Mask
            clip={false}
            mask={
              <Paragraph
                paragraph={paragraph}
                x={0}
                y={(frame.height - paragraph.getHeight()) / 2}
                width={frame.width + LAYOUT_SLACK}
              />
            }
          >
            <Rect x={0} y={0} width={frame.width} height={frame.height}>
              <LinearGradient
                start={gradientStart}
                end={gradientEnd}
                colors={gradientColors}
                mode="repeat"
              />
            </Rect>
          </Mask>
        </Canvas>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  inkHidden: {
    color: 'transparent',
  },
  canvas: {
    position: 'absolute',
  },
});
