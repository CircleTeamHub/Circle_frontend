import { Alert, type AlertButton } from 'react-native';
import i18n from '@/i18n';
import type { DialogButton } from '@/components/app/app-dialog-buttons';
import { showDialog, type DialogPromptConfig } from '@/components/app/app-dialog-store';

/**
 * 把 `Alert.alert` / `Alert.prompt` 整个改投到自绘弹窗（AppDialogHost）。
 *
 * 为什么不逐个调用点改：全 App 三百多处 Alert.alert，语义（title / message /
 * buttons / cancelable）本来就够用，接管入口一处改完，三端一致：
 * - Android：不再是系统 AlertDialog，跟 iOS 一个样。
 * - iOS：不再是 UIAlertController。
 * - Web：react-native-web 的 Alert 是空函数，之前只在 web 接管；现在三端同一条路。
 *
 * 顺带修掉两个原生坑：
 * - RN 不传 buttons 时 Android 分支硬编码英文 'OK'、iOS 按**设备**语言本地化，
 *   都不跟 App 语言走 —— 这里的默认按钮取 i18n 的 `common.ok`。
 * - `Alert.prompt` 在 Android 上是静默空操作（RN 源码只实现了 iOS），改群名 /
 *   重命名分组在安卓一直没反应 —— 现在三端都弹带输入框的弹窗。
 *
 * 关闭语义（点蒙层 / 硬件返回 / Esc）：显式 cancelable 时按原生语义只触发 onDismiss；
 * 未指定时有 cancel 按钮就等同按下它，否则锁死。见 app-dialog-store。
 *
 * 要在 i18n 水合之后装，默认按钮文案才是当前语言。
 */

type AlertArgs = Parameters<typeof Alert.alert>;
type PromptArgs = Parameters<typeof Alert.prompt>;

const PROMPT_KEYBOARD_TYPES = new Set<NonNullable<DialogPromptConfig['keyboardType']>>([
  'default',
  'email-address',
  'numeric',
  'phone-pad',
  'number-pad',
  'decimal-pad',
  'url',
]);

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return value == null ? '' : String(value);
}

function okText(): string {
  return i18n.t('common.ok', { defaultValue: '知道了' });
}

type StringPress = (value?: string) => void;

function adaptPress(onPress: AlertButton['onPress']): StringPress | undefined {
  if (!onPress) return undefined;
  // RN 的类型里还有 login-password 双输入框那一支（回调收 {login,password}），
  // App 没用、宿主也不画双框，一律按单串回调对待。
  return onPress as StringPress;
}

function normalizeButtons(
  buttons: AlertArgs[2] | undefined,
  fallbackText: string,
): DialogButton[] {
  if (!buttons || buttons.length === 0) return [];
  return buttons.map((button) => ({
    text: button.text || fallbackText,
    style: button.style,
    onPress: adaptPress(button.onPress),
  }));
}

function normalizePromptKeyboard(
  keyboardType: PromptArgs[5],
): DialogPromptConfig['keyboardType'] {
  return PROMPT_KEYBOARD_TYPES.has(keyboardType as never)
    ? (keyboardType as DialogPromptConfig['keyboardType'])
    : undefined;
}

export function installAlertBridge(): void {
  Alert.alert = (title, message, buttons, options): void => {
    showDialog({
      title: asText(title),
      message: asText(message) || undefined,
      buttons: normalizeButtons(buttons, okText()),
      cancelable: options?.cancelable,
      onDismiss: options?.onDismiss,
    });
  };

  Alert.prompt = (
    title,
    message,
    callbackOrButtons,
    type = 'plain-text',
    defaultValue,
    keyboardType,
    options,
  ): void => {
    const buttons: DialogButton[] =
      typeof callbackOrButtons === 'function'
        ? [
            { text: i18n.t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
            {
              text: i18n.t('common.confirm', { defaultValue: '确认' }),
              onPress: (value) => callbackOrButtons(value ?? ''),
            },
          ]
        : normalizeButtons(callbackOrButtons, okText());

    // RN 的 iOS Alert.alert 内部也是 prompt(type='default')：default = 没有输入框。
    const prompt: DialogPromptConfig | undefined =
      type === 'default'
        ? undefined
        : {
            defaultValue,
            secureTextEntry: type === 'secure-text',
            keyboardType: normalizePromptKeyboard(keyboardType),
          };

    showDialog({
      title: asText(title),
      message: asText(message) || undefined,
      buttons,
      cancelable: options?.cancelable,
      onDismiss: options?.onDismiss,
      prompt,
    });
  };
}
