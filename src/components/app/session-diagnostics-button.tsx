import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Application from 'expo-application';
import * as Clipboard from 'expo-clipboard';
import { readSessionDiagnostics } from '@/observability/session-diagnostics';
import { Spacing, Typography, useTheme } from '@/theme';

/** Remains available on the login page after auth storage has been cleared. */
export function SessionDiagnosticsButton() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [available, setAvailable] = useState(false);
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    let active = true;
    void readSessionDiagnostics().then(records => {
      if (active) setAvailable(records.length > 0);
    });
    return () => { active = false; };
  }, []);

  if (!available) return null;
  const copy = async () => {
    setCopying(true);
    try {
      const records = await readSessionDiagnostics();
      const copied = await Clipboard.setStringAsync(JSON.stringify({
        schemaVersion: 1, exportedAt: new Date().toISOString(), platform: Platform.OS,
        appVersion: Application.nativeApplicationVersion,
        buildVersion: Application.nativeBuildVersion, records,
      }, null, 2));
      Alert.alert(t(copied ? 'sessionDiagnostics.copied' : 'sessionDiagnostics.copyFailed'));
    } catch {
      Alert.alert(t('sessionDiagnostics.copyFailed'));
    } finally {
      setCopying(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('sessionDiagnostics.copy')}
      accessibilityState={{ disabled: copying }}
      disabled={copying}
      onPress={copy}
      style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center', padding: Spacing.md }}
    >
      <Text style={{ ...Typography.caption, color: colors.textSecondary }}>
        {t('sessionDiagnostics.copy')}
      </Text>
    </Pressable>
  );
}
