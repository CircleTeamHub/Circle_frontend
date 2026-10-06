import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import {
  fetchFriendSettings,
  setFriendPermission,
  type FriendPermission,
} from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

const PERMISSION_OPTIONS: readonly FriendPermission[] = ['FULL', 'CHAT_ONLY'];

const s = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  option: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  optionMeta: {
    flex: 1,
    gap: 2,
  },
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: 56,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  saveButton: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function EditFriendPermissionScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const profileId = typeof params.id === 'string' ? params.id : '';
  const targetName =
    typeof params.name === 'string' ? params.name : t('chat.friend');
  const [permission, setPermission] = useState<FriendPermission>('FULL');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!profileId) {
      setError(t('userProfile.editPermission.missingFriend'));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    fetchFriendSettings(profileId)
      .then((settings) => {
        if (!cancelled) setPermission(settings.permission);
      })
      .catch((nextError) => {
        if (!cancelled) setError(t('userProfile.editPermission.loadFailed'));
        reportHandledFailure('friendPermission', 'loadSettings', nextError);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profileId, t, retryVersion]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      card: { backgroundColor: colors.surface },
      title: { color: colors.text, ...Typography.body, fontWeight: '600' as const },
      helper: { color: colors.textSecondary, ...Typography.small },
      option: { borderColor: colors.surfaceBorder, backgroundColor: colors.background },
      optionActive: { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
      optionTitle: { color: colors.text, ...Typography.body, fontWeight: '600' as const },
      optionHint: { color: colors.textSecondary, ...Typography.small },
      stateText: { color: colors.textSecondary, ...Typography.bodyRegular },
      saveButton: { backgroundColor: colors.primary },
      saveButtonDisabled: { backgroundColor: colors.surfaceBorder },
      saveButtonText: { color: colors.white, ...Typography.body, fontWeight: '600' as const },
    }),
    [colors],
  );

  const handleSave = async () => {
    if (!profileId || isSaving || isLoading || Boolean(error)) return;

    try {
      setIsSaving(true);
      await setFriendPermission(profileId, permission);
      if (mountedRef.current) router.back();
    } catch (nextError) {
      if (!mountedRef.current) return;
      Alert.alert(
        t('validation.saveFailed'),
        getApiErrorMessage(nextError, t('userProfile.editPermission.saveFailed')),
      );
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  };

  const stateBlock = isLoading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>{t('userProfile.editPermission.loading')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      {profileId ? <Pressable onPress={() => setRetryVersion((version) => version + 1)} accessibilityRole="button" style={[s.saveButton, d.saveButton, { paddingHorizontal: Spacing.lg }]}>
        <Text style={d.saveButtonText}>{t('common.retry')}</Text>
      </Pressable> : null}
    </View>
  ) : (
    <View style={[s.card, d.card]}>
      <Text style={d.title}>{t('userProfile.editPermission.label', { name: targetName })}</Text>
      <Text style={d.helper}>{t('userProfile.editPermission.helper')}</Text>
      {PERMISSION_OPTIONS.map((option) => {
        const selected = permission === option;
        return (
          <Pressable
            key={option}
            style={[s.option, d.option, selected ? d.optionActive : null]}
            onPress={() => setPermission(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <View style={s.optionMeta}>
              <Text style={d.optionTitle}>
                {t(`contacts.request.permissionOptions.${option}.title`)}
              </Text>
              <Text style={d.optionHint}>
                {t(`contacts.request.permissionOptions.${option}.hint`)}
              </Text>
            </View>
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={selected ? colors.iconAccent : colors.textSecondary}
            />
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('profile.permission')} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {stateBlock}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable
          style={[s.saveButton, d.saveButton, isLoading || Boolean(error) || isSaving ? d.saveButtonDisabled : null]}
          disabled={isLoading || Boolean(error) || isSaving}
          onPress={handleSave}
        >
          <Text style={d.saveButtonText}>
            {isSaving ? t('common.saving') : t('common.save')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
