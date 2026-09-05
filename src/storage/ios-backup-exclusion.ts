import { Platform } from 'react-native';
import { reportHandledFailure } from '@/observability/report-failure';

/**
 * iOS：把 MMKV 目录排除出 iCloud/iTunes 备份（#88）。
 *
 * OpenIM 数据目录已在 im/client.ts 的 initSDK 之前用同一机制处理
 * （RNFS.mkdir + NSURLIsExcludedFromBackupKey）；MMKV 是当年遗漏的另一半。
 * react-native-mmkv 默认根目录是 `${Documents}/mmkv`，RNFS.mkdir 对已存在
 * 目录幂等，且无论新建还是已存在都会应用 resource flag。
 *
 * 失败只 dev-warn 不抛：备份排除是尽力而为的隐私加固（MMKV 今天不存 secrets，
 * tokens 在 SecureStore），不该因此挡启动。Android 由
 * plugins/with-android-allow-backup-disabled.js 覆盖，这里无事可做。
 */
export async function excludeMmkvDirFromIOSBackup(): Promise<void> {
  if (Platform.OS !== 'ios') {
    return;
  }
  try {
    // 与 im/client.ts 同款懒加载：把 react-native-fs 挡在 web/静态渲染路径之外。
    type NativeFSModule = typeof import('react-native-fs') & {
      default?: typeof import('react-native-fs');
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-fs') as NativeFSModule;
    const RNFS = loaded.default ?? loaded;
    await RNFS.mkdir(`${RNFS.DocumentDirectoryPath}/mmkv`, {
      NSURLIsExcludedFromBackupKey: true,
    });
  } catch (err) {
    reportHandledFailure('storage', 'iosBackupExclusion', err);
  }
}
