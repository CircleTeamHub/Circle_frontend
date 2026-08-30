import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { AboutArticleScreen } from '@/features/profile/screens/about-article-screen';
import {
  checkForAndroidUpdate,
  downloadAndInstallAndroidUpdate,
} from '@/features/app-update/app-update-service';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  buttonText: {
    ...Typography.body,
  },
});

export default function AboutVersionScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const checkingRef = useRef(false);
  const installingRef = useRef(false);
  const mountedRef = useRef(true);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const versionLabel = t('settingsDetails.about.versionValue', {
    version: appVersion,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const installUpdate = async (
    manifest: Awaited<ReturnType<typeof checkForAndroidUpdate>>,
  ) => {
    if (!manifest || installingRef.current) return;
    installingRef.current = true;
    setInstalling(true);
    try {
      await downloadAndInstallAndroidUpdate(manifest);
    } catch {
      if (mountedRef.current) {
        Alert.alert(
          t('appUpdate.installFailedTitle'),
          t('appUpdate.installFailedMessage'),
        );
      }
    } finally {
      installingRef.current = false;
      if (mountedRef.current) setInstalling(false);
    }
  };

  const checkNow = async () => {
    if (checkingRef.current || installingRef.current) return;
    if (Platform.OS !== 'android') {
      Alert.alert(
        t('settingsDetails.about.checkUpdates'),
        t('appUpdate.androidOnlyMessage'),
      );
      return;
    }

    checkingRef.current = true;
    setChecking(true);
    try {
      const manifest = await checkForAndroidUpdate();
      if (!mountedRef.current) return;
      if (!manifest) {
        Alert.alert(
          t('appUpdate.latestTitle'),
          t('appUpdate.latestMessage'),
        );
        return;
      }

      Alert.alert(
        t('appUpdate.availableTitle'),
        t('appUpdate.availableMessage', { version: manifest.version }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('appUpdate.updateNow'),
            onPress: () => {
              void installUpdate(manifest);
            },
          },
        ],
      );
    } catch {
      if (mountedRef.current) {
        Alert.alert(
          t('appUpdate.checkFailedTitle'),
          t('appUpdate.checkFailedMessage'),
        );
      }
    } finally {
      checkingRef.current = false;
      if (mountedRef.current) setChecking(false);
    }
  };

  const busy = checking || installing;

  return (
    <AboutArticleScreen
      titleKey="settingsDetails.about.updateTitle"
      sections={[
        {
          titleKey: 'settingsDetails.about.version',
          valueText: versionLabel,
        },
        {
          titleKey: 'settingsDetails.about.updateTitle',
          bodyKey: 'settingsDetails.about.updateBody',
        },
      ]}
      footer={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('appUpdate.checkNow')}
          disabled={busy}
          onPress={() => {
            void checkNow();
          }}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              opacity: pressed || busy ? 0.65 : 1,
            },
          ]}
        >
          {busy ? <ActivityIndicator color={colors.white} /> : null}
          <Text style={[styles.buttonText, { color: colors.white }]}>
            {checking
              ? t('appUpdate.checking')
              : installing
                ? t('appUpdate.updateNow')
                : t('appUpdate.checkNow')}
          </Text>
        </Pressable>
      }
    />
  );
}
