import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { router, useLocalSearchParams } from 'expo-router';
import { Spacing, Typography, useTheme } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import {
  fetchCircleDetail,
  updateCircle,
} from '@/services/api/circles';
import { useCreateCircleFormStore } from '@/features/discover/store/use-create-circle-form-store';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { useCircleForm } from '@/features/discover/hooks/use-circle-form';
import { CircleFormBody } from '@/features/discover/components/circle-form-body';
import type { CircleDetail } from '@/types';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

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
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function EditCircleScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const setSelectedCities = useCreateCircleFormStore(
    (state) => state.setSelectedCities,
  );
  const resetCreateCircleForm = useCreateCircleFormStore(
    (state) => state.reset,
  );
  const fetchMyCircles = useCirclesStore((state) => state.fetchMyCircles);

  const form = useCircleForm();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [circle, setCircle] = useState<CircleDetail | null>(null);

  useEffect(() => () => resetCreateCircleForm(), [resetCreateCircleForm]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      submitBtn: { backgroundColor: colors.primary },
      submitBtnDisabled: { backgroundColor: colors.surfaceBorder },
      submitText: { color: colors.white },
    }),
    [colors],
  );

  const loadCircle = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchCircleDetail(id);
      if (data.myRole !== 'OWNER' && data.myRole !== 'ADMIN') {
        Alert.alert(t('circle.error'), t('circle.loadError'));
        router.back();
        return;
      }

      setCircle(data);
      form.hydrate({
        name: data.name,
        selectedCategories: data.categories,
        description: data.description,
        avatarUri: data.avatarUrl,
        pickedAvatarUri: null,
        rules: data.rules,
        tags: data.tags,
        joinVipRestriction: data.joinVipRestriction,
        joinCreditRestriction: data.joinCreditRestriction,
        joinFancyRestriction: data.joinFancyRestriction,
        memberCanPost: data.memberCanPost,
      });
      setSelectedCities(data.cities);
    } catch {
      Alert.alert(t('circle.error'), t('circle.loadError'));
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, form, setSelectedCities, t]);

  useEffect(() => {
    void loadCircle();
    // form.hydrate is stable; loadCircle is wrapped. Exhaustive-deps is satisfied,
    // but `form` reference (returned from useCircleForm) changes on every render —
    // we deliberately only fire on `id` change. Suppress with explicit dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const selectedCities = useCreateCircleFormStore(
    (state) => state.selectedCities,
  );
  const canSubmit =
    !loading &&
    form.name.trim().length >= 2 &&
    form.description.trim().length >= 10;

  const handleSubmit = useCallback(async () => {
    if (!id || !circle || !canSubmit || submitting) return;

    setSubmitting(true);
    try {
      let uploadedAvatarUrl = form.avatarUri ?? undefined;
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
          });
          await uploadLocalFileToPresignedUrl(
            presign.uploadUrl,
            contentType,
            form.pickedAvatarUri,
          );
          uploadedAvatarUrl = presign.fileUrl;
        } catch (error) {
          // 头像上传失败时保留旧头像（不阻塞整个编辑流程）。
          uploadedAvatarUrl = circle.avatarUrl ?? undefined;
          if (__DEV__) {
            console.warn(
              '[EditCircleScreen] avatar upload failed, keeping previous avatar',
              error,
            );
          }
        }
      }

      await updateCircle(id, {
        name: form.name.trim(),
        categories: form.selectedCategories,
        description: form.description.trim(),
        avatarUrl: uploadedAvatarUrl,
        cities: selectedCities.length > 0 ? selectedCities : [],
        rules: form.rules.trim(),
        tags: form.tags,
        joinVipRestriction: form.joinVipRestriction,
        joinCreditRestriction: form.joinCreditRestriction,
        joinFancyRestriction: form.joinFancyRestriction,
        memberCanPost: form.memberCanPost,
      });
      await fetchMyCircles();
      resetCreateCircleForm();
      router.back();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('common.errorOccurred');
      Alert.alert(t('circle.error'), message);
    } finally {
      setSubmitting(false);
    }
  }, [
    id,
    circle,
    canSubmit,
    submitting,
    form,
    selectedCities,
    fetchMyCircles,
    resetCreateCircleForm,
    t,
  ]);

  if (loading) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('circle.edit')} />
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('circle.edit')} />
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
            <Text style={[s.submitText, d.submitText]}>{t('common.save')}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
