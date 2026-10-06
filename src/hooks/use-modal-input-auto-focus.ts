import { useEffect, type RefObject } from 'react';
import { Platform, type TextInput } from 'react-native';

/**
 * Modal / 底部面板里的输入框要不要走原生 autoFocus。Android 上不要：
 * RN 的 autoFocus 在输入框挂到窗口那一刻就 requestFocus + showSoftInput，
 * 而 Modal 是个新 Dialog 窗口，这时还没拿到窗口焦点，showSoftInput 静默失败——
 * 光标在、键盘不弹，得用户再点一下（Android 16 模拟器实测）。
 * 更糟的是 JS 侧已记为「已聚焦」，之后再调 focus() 会被 TextInputState 当成 no-op 跳过。
 */
export const MODAL_INPUT_NATIVE_AUTO_FOCUS = Platform.OS !== 'android';

// Dialog 窗口 show 之后拿到焦点只要一两帧，留足余量又不至于让人感觉慢。
const ANDROID_MODAL_FOCUS_DELAY_MS = 150;

/**
 * 配合 `autoFocus={MODAL_INPUT_NATIVE_AUTO_FOCUS}` 使用：Android 等 Dialog 窗口起来后再 focus()，
 * 这时 showSoftInput 才生效。`focusKey` 为 null/false 时不聚焦；换成新值（新弹窗、面板重新打开）会再聚焦一次。
 */
export function useModalInputAutoFocus(
  ref: RefObject<TextInput | null>,
  focusKey: unknown,
): void {
  useEffect(() => {
    if (Platform.OS !== 'android' || focusKey == null || focusKey === false) return;
    const timer = setTimeout(() => ref.current?.focus(), ANDROID_MODAL_FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusKey, ref]);
}
