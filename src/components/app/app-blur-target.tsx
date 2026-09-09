import { createRef, type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurTargetView } from 'expo-blur';

/**
 * Android 的实时模糊靶子。
 *
 * expo-blur 在 Android 上只肯模糊**显式指定**的 BlurTargetView（没有靶子就退化成
 * 纯色叠层）。把整棵 App 内容包成靶子、把 ref 放在模块级，弹窗（在独立的 Dialog
 * 窗口里）和顶部横幅都能拿到它 —— dimezis 是把靶子的视图树重绘进位图再模糊，
 * 跨窗口也采得到。iOS / Web 直接透传，不多套一层原生视图。
 */
const targetRef = createRef<View>();

const s = StyleSheet.create({
  fill: { flex: 1 },
});

export function getAppBlurTarget(): RefObject<View | null> | null {
  return Platform.OS === 'android' ? targetRef : null;
}

export function AppBlurTarget({ children }: { children: ReactNode }) {
  if (Platform.OS !== 'android') return <>{children}</>;
  return (
    <BlurTargetView ref={targetRef} style={s.fill}>
      {children}
    </BlurTargetView>
  );
}
