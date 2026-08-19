import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Spacing, Typography, useTheme } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { createCircle } from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import { useCreateCircleFormStore } from '@/features/discover/store/use-create-circle-form-store';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { useAuthStore } from '@/stores/authStore';
import { useCircleForm } from '@/features/discover/hooks/use-circle-form';
import { CircleFormBody } from '@/features/discover/components/circle-form-body';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { resolveMembershipEntitlementLevel } from '@/features/profile/membership-plans';
import { useMembershipProgramStore } from '@/stores/membershipProgramStore';

const s = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: Spacing.lg },
  submitWrap: { paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
  submitBtn: {
    borderRadius: 25,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontSize: 16, fontWeight: '600' as const },
  vipGate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
});

export default function CreateCircleScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const fetchMyCircles = useCirclesStore((state) => state.fetchMyCircles);
  const status = useMembershipProgramStore((state) => state.status);
  const fetchProgramStatus = useMembershipProgramStore(
    (state) => state.fetchStatus,
  );
  const entitlementLevel = resolveMembershipEntitlementLevel(
    user?.vipLevel ?? 0,
    status?.entitlementFloorLevel ?? 0,
  );
  const selectedCities = useCreateCircleFormStore(
    (state) => state.selectedCities,
  );
  const resetCreateCircleForm = useCreateCircleFormStore(
    (state) => state.reset,
  );

  const form = useCircleForm();
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void fetchProgramStatus({ force: true });
    }, [fetchProgramStatus]),
  );

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      submitBtn: { backgroundColor: colors.primary },
      submitBtnDisabled: { backgroundColor: colors.surfaceBorder },
      submitText: { color: colors.white },
      vipText: {
        color: colors.textSecondary,
        ...Typography.body,
        textAlign: 'center' as const,
      },
    }),
    [colors],
  );

  const canSubmit =
    form.name.trim().length >= 2 && form.description.trim().length >= 10;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      let uploadedAvatarUrl: string | undefined;
      if (form.pickedAvatarUri) {
        try {
          const fileName =
            form.pickedAvatarUri.split('/').pop() ?? 'avatar.jpg';
          const contentType =
            resolveUploadContentType({ fileName }) ?? 'image/jpeg';
          const presign = await requestUploadPresign({
            filename: sanitizeUploadFilename(fileName),
            contentType,
            folder: 'avatars',
            fileUri: form.pickedAvatarUri,
          });
          await uploadLocalFileToPresignedUrl(
            presign.uploadUrl,
            contentType,
            form.pickedAvatarUri,
            presign.requiredHeaders,
          );
          uploadedAvatarUrl = presign.fileUrl;
        } catch (error) {
          // 头像上传是非阻塞的 —— 失败时圈子还能创建（avatarUrl 留空）。
          if (__DEV__) {
            console.warn(
              '[CreateCircleScreen] avatar upload failed, creating without avatar',
              error,
            );
          }
        }
      }

      await createCircle({
        name: form.name.trim(),
        categories: form.selectedCategories,
        description: form.description.trim(),
        avatarUrl: uploadedAvatarUrl,
        cities: selectedCities.length > 0 ? selectedCities : undefined,
        rules: form.rules.trim() || undefined,
        joinVipRestriction: form.joinVipRestriction,
        joinCreditRestriction: form.joinCreditRestriction,
        joinFancyRestriction: form.joinFancyRestriction || undefined,
        memberCanPost: form.memberCanPost,
        requiredVerifierCount: form.requiredVerifierCount,
      });
      // review 修复：force 绕过在飞合并 —— 否则可能 await 到建圈前出发的
      // 快照，返回列表页看不到刚建的圈子。
      await fetchMyCircles({ force: true });
      resetCreateCircleForm();
      router.back();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t('circle.create.failed'));
      Alert.alert(t('circle.create.failed'), message);
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    submitting,
    form,
    selectedCities,
    fetchMyCircles,
    resetCreateCircleForm,
    router,
    t,
  ]);

  // VIP gate
  // When rollout status is not available yet, let the backend remain
  // authoritative instead of incorrectly blocking users entitled by the floor.
  if (!user || (status !== null && entitlementLevel < 1)) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('circle.create.title')} />
        <View style={s.vipGate}>
          <Ionicons name="diamond" size={48} color={colors.warning} />
          <Text style={d.vipText}>{t('circle.create.vipRequired')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('circle.create.title')} />
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        <CircleFormBody form={form} />
        <View style={{ height: Spacing.xl }} />
      </ScrollView>

      <View style={[s.submitWrap, { paddingBottom: insets.bottom || 34 }]}>
        {!canSubmit ? (
          <Text
            style={{
              color: colors.textSecondary,
              ...Typography.caption,
              textAlign: 'center',
              marginBottom: Spacing.sm,
            }}
          >
            {form.name.trim().length < 2
              ? t('circle.create.nameRequired')
              : t('circle.create.descRequired')}
          </Text>
        ) : null}
        <Pressable
          style={[
            s.submitBtn,
            canSubmit && !submitting ? d.submitBtn : d.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={[s.submitText, d.submitText]}>
              {t('circle.create.submitButton')}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
