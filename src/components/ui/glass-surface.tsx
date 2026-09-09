import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { getAppBlurTarget } from '@/components/app/app-blur-target';
import { useTheme, withAlpha } from '@/theme';

export type GlassMaterial = 'dialog' | 'banner';

/**
 * 弹窗蒙层的深浅。用户拍板**不要蒙层**（0）：玻璃卡片直接浮在内容上，模态靠全屏
 * 的触摸拦截层保证，不靠压暗。留着常量是因为 Android 的玻璃要拿同一个数：它的
 * 模糊采的是 Dialog 窗口**下面**那层 Activity（没被蒙层压过），一旦有蒙层就得在
 * 采样结果上再压一次同样的深浅，卡片里外亮度才一致。
 */
export const DIALOG_SCRIM_ALPHA = 0;

interface GlassSurfaceProps {
  material: GlassMaterial;
  radius: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * 材质档位。要一眼看出是玻璃，底色必须够淡、后面的内容要真透过来 —— 参照 tab bar
 * （Thin@30 + 6% 底色）。用超薄材质：它自带的白/黑蒙很轻，强度只负责模糊。
 * 弹窗底色比横幅略实一点，它要托住整段正文。
 * 旧系统没有液态玻璃自带的那层模糊，靠 BlurView 单打独斗时强度补一档（见 frostIntensity）。
 */
const MATERIALS: Record<
  GlassMaterial,
  {
    intensity: number;
    tintAlpha: number;
    /** Android 采样结果上补压的暗度（见 DIALOG_SCRIM_ALPHA）；横幅没有蒙层不用补。 */
    androidDim: number;
    ios: {
      dark: 'systemUltraThinMaterialDark';
      light: 'systemUltraThinMaterialLight';
    };
  }
> = {
  dialog: {
    intensity: 18,
    tintAlpha: 0.04,
    androidDim: DIALOG_SCRIM_ALPHA,
    ios: { dark: 'systemUltraThinMaterialDark', light: 'systemUltraThinMaterialLight' },
  },
  banner: {
    intensity: 18,
    tintAlpha: 0.03,
    androidDim: 0,
    ios: { dark: 'systemUltraThinMaterialDark', light: 'systemUltraThinMaterialLight' },
  },
};

/** 没有液态玻璃兜底模糊的旧 iOS，磨砂强度补这么多，正文才不会和后面的字叠在一起。 */
const LEGACY_FROST_BOOST = 35;

/** 没有真磨砂时（Web、Android 缺靶子）：底色实到这个程度，文字在任何内容上都读得清。 */
const FALLBACK_SURFACE_ALPHA = 0.94;

/**
 * Android：expo-blur 把 intensity 同时用作模糊半径（÷ blurReductionFactor）和叠色
 * 透明度（× tint 系数）。要"糊得够、色不重"，就把 reduction 压到 1 换大半径，
 * intensity 本身留小，叠色只剩十来个百分点；tint 选叠色系数最小的档。
 */
const ANDROID_BLUR_INTENSITY = 24;
const ANDROID_BLUR_REDUCTION = 1;

const s = StyleSheet.create({
  base: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
});

/**
 * 玻璃面：弹窗卡片与顶部横幅共用的材质外壳。
 *
 * - iOS 26+：expo-glass-effect 的液态玻璃（折射）+ 叠一层磨砂 + 半透明底色。
 *   只有折射没有磨砂的话正文糊在动态内容上读不清，也会和旧系统长成两种东西。
 * - 其他 iOS：UIVisualEffectView 磨砂 + 同一档底色。
 * - Android：expo-blur 的 dimezis 实时模糊，靶子是整棵 App 内容（见 app-blur-target）；
 *   拿不到靶子时退回半透明实底。
 * - Web：backdrop-filter 支持就有真磨砂，不支持就是半透明实底。轮廓描边三端一致。
 *
 * 注意：UIVisualEffectView / GlassView 的任何祖先 opacity < 1 都会让材质失效
 * （Apple 文档明说）。要做淡入淡出只能动它里面的内容，容器只做位移 / 缩放。
 */
export function GlassSurface({ material, radius, style, children }: GlassSurfaceProps) {
  const { colors, resolvedMode } = useTheme();
  const spec = MATERIALS[material];
  const tint = { backgroundColor: withAlpha(colors.surface, spec.tintAlpha) };
  const shape = { borderRadius: radius };
  const frame = [s.base, shape, { borderColor: colors.glassBorder }, style];

  if (Platform.OS === 'ios') {
    // GlassView 在旧系统只是普通 View；API 可用性检查同时规避早期 iOS 26 beta
    // 实例化会崩的问题（与 tab bar 同一套判断）。
    const liquid = isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
    const frostIntensity = liquid ? spec.intensity : spec.intensity + LEGACY_FROST_BOOST;
    const frost = (
      <BlurView
        intensity={frostIntensity}
        tint={spec.ios[resolvedMode]}
        style={[s.layer, shape]}
        pointerEvents="none"
      />
    );
    const wash = <View style={[s.layer, shape, tint]} pointerEvents="none" />;

    if (liquid) {
      return (
        <GlassView colorScheme={resolvedMode} glassEffectStyle="regular" style={frame}>
          {frost}
          {wash}
          {children}
        </GlassView>
      );
    }
    return (
      <View style={frame}>
        {frost}
        {wash}
        {children}
      </View>
    );
  }

  const androidTarget = Platform.OS === 'android' ? getAppBlurTarget() : null;
  if (androidTarget) {
    return (
      <View style={frame}>
        <BlurView
          blurMethod="dimezisBlurViewSdk31Plus"
          blurTarget={androidTarget}
          intensity={ANDROID_BLUR_INTENSITY}
          blurReductionFactor={ANDROID_BLUR_REDUCTION}
          // 'default' 是白色 ×0.3 的最轻叠色；暗色用超薄暗材质（×0.55 的深灰）。
          tint={resolvedMode === 'dark' ? 'systemUltraThinMaterialDark' : 'default'}
          style={[s.layer, shape]}
          pointerEvents="none"
        />
        {spec.androidDim > 0 ? (
          <View
            style={[s.layer, shape, { backgroundColor: withAlpha(colors.black, spec.androidDim) }]}
            pointerEvents="none"
          />
        ) : null}
        <View style={[s.layer, shape, tint]} pointerEvents="none" />
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        frame,
        { backgroundColor: withAlpha(colors.surface, FALLBACK_SURFACE_ALPHA) },
        // RNW 支持就有真磨砂，不支持就是普通半透明 —— 两种结果都可接受。
        Platform.OS === 'web' ? WEB_BACKDROP_BLUR : null,
      ]}
    >
      {children}
    </View>
  );
}

const WEB_BACKDROP_BLUR = {
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
} as unknown as ViewStyle;
