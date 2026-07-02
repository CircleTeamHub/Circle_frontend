import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import {
  fetchFriendSettings,
  setFriendRemark,
} from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { useFriendRemarkStore } from '@/stores/friendRemarkStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const s = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  fieldLabel: {
    ...Typography.small,
    fontWeight: '600',
  },
  helper: {
    ...Typography.small,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.bodyRegular,
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
  button: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function EditFriendRemarkScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string; name?: string; fallbackName?: string }>();
  const profileId = typeof params.id === 'string' ? params.id : '';
  const routeFallbackName =
    typeof params.fallbackName === 'string' ? params.fallbackName.trim() : '';
  const targetName =
    typeof params.name === 'string' ? params.name : routeFallbackName || t('chat.friend');
  const remarkFallbackName = routeFallbackName || targetName;

  const [value, setValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    if (!profileId) {
      setError(t('userProfile.editRemark.missingFriend'));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetchFriendSettings(profileId)
      .then((settings) => {
        if (cancelled) {
          return;
        }

        setValue(settings.remark ?? '');
        setError(null);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(t('userProfile.editRemark.loadFailed'));
        }
        if (__DEV__) {
          console.warn(
            '[EditFriendRemarkScreen] fetchFriendSettings failed',
            nextError,
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profileId, t]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      card: {
        backgroundColor: colors.surface,
      },
      fieldLabel: {
        color: colors.textSecondary,
      },
      helper: {
        color: colors.textSecondary,
      },
      input: {
        color: colors.text,
        backgroundColor: colors.background,
        borderColor: colors.surfaceBorder,
      },
      stateText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      button: {
        backgroundColor: colors.primary,
      },
      buttonDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
      buttonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const handleSave = useCallback(async () => {
    if (!profileId || isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      await setFriendRemark(profileId, value);
      if (!mountedRef.current) return;
      // 广播备注变更，让已挂载的聊天页 / 资料页即时刷新显示名。
      useFriendRemarkStore.getState().setRemark(profileId, value, remarkFallbackName);
      router.back();
    } catch (nextError) {
      if (!mountedRef.current) return;
      Alert.alert(
        t('validation.saveFailed'),
        getApiErrorMessage(nextError, t('userProfile.editRemark.saveFailed')),
      );
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, [isSaving, profileId, remarkFallbackName, t, value]);

  const stateBlock = isLoading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>{t('userProfile.editRemark.loading')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
    </View>
  ) : (
    <View style={[s.card, d.card]}>
      <Text style={[s.fieldLabel, d.fieldLabel]}>
        {t('userProfile.editRemark.label', { name: targetName })}
      </Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        maxLength={50}
        placeholder={t('userProfile.editRemark.placeholder')}
        placeholderTextColor={colors.textSecondary}
        style={[s.input, d.input]}
      />
      <Text style={[s.helper, d.helper]}>
        {t('userProfile.editRemark.helper')}
      </Text>
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('profile.setRemark')} />
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        {stateBlock}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable
          style={[
            s.button,
            d.button,
            isLoading || Boolean(error) || isSaving ? d.buttonDisabled : null,
          ]}
          disabled={isLoading || Boolean(error) || isSaving}
          onPress={handleSave}
        >
          <Text style={d.buttonText}>{isSaving ? t('common.saving') : t('common.save')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
