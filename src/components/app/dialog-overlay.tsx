import type { ReactNode } from 'react';
import { Modal, Platform } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';

interface DialogOverlayProps {
  visible: boolean;
  /** Android 硬件返回 / Web Esc。 */
  onRequestClose: () => void;
  children: ReactNode;
}

/**
 * 弹窗的「窗口层」载体，按平台选实现：
 *
 * - iOS：react-native-screens 的 FullWindowOverlay —— 挂到 UIWindow 顶层，能压在
 *   已经 present 出来的原生 Modal（底部面板、图片查看器、评论输入条）之上。
 *   若用 RN Modal：宿主挂在根布局，它会从根 VC present；根 VC 正在 present 面板时
 *   UIKit 直接拒绝（"already presenting"），从面板里发起的确认框永远出不来。
 *   只在有弹窗时才挂载：容器是挂载那一刻 addSubview 到窗口的，晚挂才能压在
 *   已有面板之上。
 * - Android / Web：透明 RN Modal。Android 的 Dialog 天然可叠、硬件返回走
 *   onRequestClose；RNW 的 Modal 是 body 末尾的 portal，Esc 也走 onRequestClose。
 */
export function DialogOverlay({ visible, onRequestClose, children }: DialogOverlayProps) {
  if (Platform.OS === 'ios') {
    if (!visible) return null;
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal>
        {children}
      </FullWindowOverlay>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onRequestClose}
    >
      {children}
    </Modal>
  );
}
