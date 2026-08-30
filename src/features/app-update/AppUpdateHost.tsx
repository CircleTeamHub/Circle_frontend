import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  checkForAndroidUpdate,
  downloadAndInstallAndroidUpdate,
} from './app-update-service';

let startupCheckPromise: ReturnType<typeof checkForAndroidUpdate> | null = null;
let startupPromptShown = false;

function getStartupCheck() {
  startupCheckPromise ??= checkForAndroidUpdate();
  return startupCheckPromise;
}

export function AppUpdateHost() {
  const { t } = useTranslation();

  useEffect(() => {
    let active = true;

    getStartupCheck()
      .then((manifest) => {
        if (!active || !manifest || startupPromptShown) {
          return;
        }
        startupPromptShown = true;
        let installing = false;

        Alert.alert(
          t('appUpdate.availableTitle', { defaultValue: '发现新版本' }),
          t('appUpdate.availableMessage', {
            version: manifest.version,
            defaultValue: '风信 {{version}} 已发布，是否现在更新？',
          }),
          [
            {
              text: t('common.cancel', { defaultValue: '取消' }),
              style: 'cancel',
            },
            {
              text: t('appUpdate.updateNow', { defaultValue: '立即更新' }),
              onPress: () => {
                if (installing) return;
                installing = true;
                void downloadAndInstallAndroidUpdate(manifest)
                  .catch(() => {
                    Alert.alert(
                      t('appUpdate.installFailedTitle', {
                        defaultValue: '更新失败',
                      }),
                      t('appUpdate.installFailedMessage', {
                        defaultValue: '无法下载安装包，请检查网络后重试。',
                      }),
                    );
                  })
                  .finally(() => {
                    installing = false;
                  });
              },
            },
          ],
        );
      })
      .catch(() => {
        // 启动检查是尽力而为；网络异常不能阻塞登录或启动流程。
      });

    return () => {
      active = false;
    };
  }, [t]);

  return null;
}
