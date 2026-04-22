import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Radius, Spacing, Typography, useTheme } from '@/theme';

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
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const profileId = typeof params.id === 'string' ? params.id : '';
  const targetName = typeof params.name === 'string' ? params.name : t('chat.friend');

  const [value, setValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      .catch(() => {
        if (!cancelled) {
          setError(t('userProfile.editRemark.loadFailed'));
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
      router.back();
    } catch (nextError) {
      Alert.alert(
        t('validation.saveFailed'),
        nextError instanceof Error ? nextError.message : t('userProfile.editRemark.saveFailed'),
      );
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, profileId, t, value]);

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
