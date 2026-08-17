import { Alert } from 'react-native';
import i18n from '@/i18n';

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
