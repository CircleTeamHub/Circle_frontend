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
import { useAuthStore } from '@/stores/authStore';

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
  const ownerId = useAuthStore((state) => state.isAuthenticated ? state.user?.id : undefined);
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const scopeKey = `${ownerId ?? ''}:${sessionEpoch}:${profileId}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const originOwner = useRef(ownerId);
  const targetName =
    originOwner.current === ownerId && typeof params.name === 'string' ? params.name : t('chat.friend');
  const [permission, setPermission] = useState<FriendPermission | null>(null);
  const [loadedScope, setLoadedScope] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const mountedRef = useRef(true);
  const saveRef = useRef<symbol | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCurrent = () => {
      const auth = useAuthStore.getState();
      return !cancelled && mountedRef.current && scopeRef.current === scopeKey &&
        auth.isAuthenticated && auth.user?.id === ownerId && auth.sessionEpoch === sessionEpoch;
    };
    saveRef.current = null;
    setIsSaving(false);
    setLoadedScope('');
    setPermission(null);

    if (!profileId || !ownerId) {
      setError(t(!profileId ? 'userProfile.editPermission.missingFriend' : 'userProfile.editPermission.loadFailed'));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    fetchFriendSettings(profileId)
      .then((settings) => {
        if (!isCurrent()) return;
        if (settings?.permission !== 'FULL' && settings?.permission !== 'CHAT_ONLY') {
          throw new Error('Unsupported friend permission response');
        }
        setPermission(settings.permission);
        setLoadedScope(scopeKey);
      })
      .catch((nextError) => {
        if (!isCurrent()) return;
        setError(t('userProfile.editPermission.loadFailed'));
        reportHandledFailure('friendPermission', 'loadSettings', nextError);
      })
      .finally(() => {
        if (isCurrent()) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ownerId, profileId, retryVersion, scopeKey, sessionEpoch, t]);

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
    const auth = useAuthStore.getState();
    if (!profileId || !ownerId || permission === null || saveRef.current || isSaving ||
      isLoading || error || loadedScope !== scopeKey || !auth.isAuthenticated ||
      auth.user?.id !== ownerId || auth.sessionEpoch !== sessionEpoch) return;
    const operation = Symbol('saveFriendPermission');
    saveRef.current = operation;
    const isCurrent = () => {
      const currentAuth = useAuthStore.getState();
      return mountedRef.current && saveRef.current === operation && scopeRef.current === scopeKey &&
        currentAuth.isAuthenticated && currentAuth.user?.id === ownerId && currentAuth.sessionEpoch === sessionEpoch;
    };

    try {
      setIsSaving(true);
      await setFriendPermission(profileId, permission);
      if (isCurrent()) router.back();
    } catch (nextError) {
      if (!isCurrent()) return;
      Alert.alert(
        t('validation.saveFailed'),
        getApiErrorMessage(nextError, t('userProfile.editPermission.saveFailed')),
      );
    } finally {
      if (isCurrent()) {
        saveRef.current = null;
        setIsSaving(false);
      }
    }
  };

  const waitingForScope = Boolean(ownerId && profileId) && !error && loadedScope !== scopeKey;
  const saveDisabled = isLoading || waitingForScope || Boolean(error) || isSaving || permission === null;
  const stateBlock = isLoading || waitingForScope ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>{t('userProfile.editPermission.loading')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      {profileId && ownerId ? <Pressable onPress={() => setRetryVersion((version) => version + 1)} accessibilityRole="button" style={[s.saveButton, d.saveButton, { paddingHorizontal: Spacing.lg }]}>
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
          style={[s.saveButton, d.saveButton, saveDisabled ? d.saveButtonDisabled : null]}
          disabled={saveDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: saveDisabled }}
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
