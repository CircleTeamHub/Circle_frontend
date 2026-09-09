/**
 * 弹窗按钮的排版决策（纯函数，不碰 React / RN）。
 *
 * 输入是 `Alert.alert` 语义的按钮列表（text / style / onPress），输出是宿主怎么摆：
 * - 1 个：整宽实心主按钮（destructive → 红色实心）。
 * - 2 个：并排；cancel 靠左做次要样式，另一个做主按钮。两个都不是 cancel 时，
 *   前一个次要、后一个主按钮 —— 与 iOS「最后一个是默认动作」的阅读顺序一致。
 * - ≥3 个：竖排菜单（长按图片 / 会话行操作那类调用）；选项按出现顺序，
 *   destructive 红字，cancel 沉底（iOS 惯例，也是拇指最顺手的位置）。
 */

export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';

export interface DialogButton {
  text: string;
  style?: DialogButtonStyle;
  /** prompt 弹窗会把输入框内容作为 value 传入；普通弹窗不传参。 */
  onPress?: (value?: string) => void;
}

export type DialogButtonRole =
  | 'primary'
  | 'destructive'
  | 'secondary'
  | 'option'
  | 'optionDestructive'
  | 'cancel';

export interface DialogButtonSlot {
  button: DialogButton;
  role: DialogButtonRole;
}

export interface DialogButtonLayout {
  direction: 'row' | 'column';
  slots: DialogButtonSlot[];
}

const isCancel = (button: DialogButton): boolean => button.style === 'cancel';

function rowRole(button: DialogButton, isLastAction: boolean): DialogButtonRole {
  if (isCancel(button)) return 'cancel';
  if (button.style === 'destructive') return 'destructive';
  return isLastAction ? 'primary' : 'secondary';
}

export function resolveDialogButtonLayout(
  buttons: readonly DialogButton[],
): DialogButtonLayout {
  const cancels = buttons.filter(isCancel);
  const actions = buttons.filter((button) => !isCancel(button));

  if (buttons.length <= 2) {
    const lastAction = actions[actions.length - 1];
    // cancel 永远靠左，其余保持调用方顺序。
    const ordered = [...cancels, ...actions];
    return {
      direction: 'row',
      slots: ordered.map((button) => ({
        button,
        role: rowRole(button, button === lastAction),
      })),
    };
  }

  return {
    direction: 'column',
    slots: [
      ...actions.map((button) => ({
        button,
        role:
          button.style === 'destructive'
            ? ('optionDestructive' as const)
            : ('option' as const),
      })),
      ...cancels.map((button) => ({ button, role: 'cancel' as const })),
    ],
  };
}
