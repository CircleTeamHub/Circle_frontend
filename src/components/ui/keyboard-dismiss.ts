import {
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

export function dismissKeyboardOnScrollBeginDrag(
  _event?: NativeSyntheticEvent<NativeScrollEvent>,
) {
  Keyboard.dismiss();
}

export const keyboardDismissOnDragProps = {
  keyboardDismissMode: 'on-drag' as const,
  keyboardShouldPersistTaps: 'handled' as const,
  onScrollBeginDrag: dismissKeyboardOnScrollBeginDrag,
};
