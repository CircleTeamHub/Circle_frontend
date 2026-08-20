import { Alert, Platform } from 'react-native';
import i18n from '@/i18n';
import {
  presentWebAlert,
  type WebAlertButton,
} from '@/components/app/web-alert-host';

/**
 * 给 `Alert.alert` 补一个本地化的默认按钮。
 *
 * 为什么需要：不传 buttons 时 React Native 会自己补一个确定按钮，而那个文案
 * **不跟随 App 语言** —— Android 分支在 JS 层硬编码 `'OK'`
 * (react-native/Libraries/Alert/Alert.js，注释原话是「这个文本本该被本地化」)，
 * iOS 交给原生按**设备语言**本地化。结果是：系统是英文、App 切成中文的用户，
 * 全 App 两百多个提示框的按钮都显示英文 OK。
 *
 * 这里在入口处包一层：调用方没给 buttons 时补上 `common.confirm`；
 * 给了 buttons 的调用完全不受影响。i18n 已初始化后再装，保证取到的是当前语言。
 */
export function installLocalizedAlertDefaults(): void {
  // Web：react-native-web 的 Alert.alert 是**空函数**（class Alert {
  // static alert() {} }），全部对话框会静默失效 —— 整个改指到 WebAlertHost
  // 的命令式桥（主题化模态，见 components/app/web-alert-host.tsx）。
  if (Platform.OS === 'web') {
    installWebAlert();
    return;
  }
  const original = Alert.alert.bind(Alert);
  type AlertArgs = Parameters<typeof Alert.alert>;

  Alert.alert = (
    title: AlertArgs[0],
    message?: AlertArgs[1],
    buttons?: AlertArgs[2],
    options?: AlertArgs[3],
  ): void => {
    if (buttons && buttons.length > 0) {
      original(title, message, buttons, options);
      return;
    }
    original(
      title,
      message,
      [{ text: i18n.t('common.confirm', { defaultValue: '确认' }) }],
      options,
    );
  };
}

function installWebAlert(): void {
  type AlertArgs = Parameters<typeof Alert.alert>;

  Alert.alert = (
    title: AlertArgs[0],
    message?: AlertArgs[1],
    buttons?: AlertArgs[2],
    options?: AlertArgs[3],
  ): void => {
    const fallbackText = i18n.t('common.confirm', { defaultValue: '确认' });
    const normalized: WebAlertButton[] =
      buttons && buttons.length > 0
        ? buttons.map((button) => ({
            text: button.text ?? fallbackText,
            style: button.style,
            onPress: button.onPress
              ? () => {
                  button.onPress?.();
                }
              : undefined,
          }))
        : [{ text: fallbackText }];

    presentWebAlert({
      title: typeof title === 'string' ? title : String(title ?? ''),
      message: message ?? undefined,
      buttons: normalized,
      // 原生 Android 默认蒙层不可关，但 web 上"点外面关掉"是桌面惯例；
      // 只有调用方显式 cancelable:false 才锁死。关闭走 onDismiss，
      // 与原生语义一致（不触发任何按钮）。
      cancelable: options?.cancelable !== false,
      onDismiss: options?.onDismiss,
    });
  };
}
