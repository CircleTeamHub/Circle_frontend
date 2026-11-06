import type { ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { DialogOverlay } from '@/components/app/dialog-overlay';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';

interface FloatingModalProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  backdropStyle?: StyleProp<ViewStyle>;
  cardStyle?: StyleProp<ViewStyle>;
  closeOnBackdropPress?: boolean;
  avoidKeyboard?: boolean;
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  center: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '100%',
    minHeight: 0,
    flexShrink: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
});

/** A centered dialog that lives in the top-level window instead of a bottom sheet. */
export function FloatingModal({
  visible,
  onClose,
  children,
  backdropStyle,
  cardStyle,
  closeOnBackdropPress = true,
  avoidKeyboard = true,
}: FloatingModalProps) {
  // 键盘弹着时点空白处只收键盘:用户多半只是想看清弹窗,不是要放弃正在填的内容。
  const handleBackdropPress = () => {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    if (closeOnBackdropPress) onClose();
  };
  const content = (
    <Pressable
      style={s.center}
      onPress={handleBackdropPress}
      testID="floating-modal-backdrop"
      accessibilityViewIsModal
    >
      <View
        style={[s.card, cardStyle]}
        onStartShouldSetResponder={() => true}
      >
        {children}
      </View>
    </Pressable>
  );

  return (
    <DialogOverlay visible={visible} onRequestClose={onClose}>
      <View style={s.fill}>
        <Pressable
          pointerEvents="none"
          style={[s.backdrop, backdropStyle]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        {avoidKeyboard ? (
          <KeyboardAvoidingContainer style={s.fill} behavior="padding">
            {content}
          </KeyboardAvoidingContainer>
        ) : (
          content
        )}
      </View>
    </DialogOverlay>
  );
}
