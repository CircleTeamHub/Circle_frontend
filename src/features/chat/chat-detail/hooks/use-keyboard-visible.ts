import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * 键盘是否弹起(iOS 用 Will* 事件,与 KeyboardAvoidingView 的动画同步)。
 */
export function useKeyboardVisible() {
  // 键盘弹起时 KeyboardAvoidingView 已把输入栏顶到键盘上方，此时再叠加 insets.bottom
  // 安全区 padding 会在输入框与键盘间留一道空白。跟踪键盘可见状态，弹起时收掉这层 padding。
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  // 跟踪键盘显隐：iOS 用 Will* 事件与 KeyboardAvoidingView 动画同步，避免空白闪一下。
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () =>
      setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(hideEvent, () =>
      setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return {
    keyboardVisible,
  };
}
