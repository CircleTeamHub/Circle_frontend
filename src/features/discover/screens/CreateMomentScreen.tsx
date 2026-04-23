import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { createMoment } from '@/services/api/moments';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useMomentsStore } from '@/features/discover/store/use-moments-store';

const s = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: Spacing.lg },
  inputBox: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  contentInput: {
    ...Typography.bodyRegular,
    lineHeight: 21,
    textAlignVertical: 'top' as const,
    minHeight: 120,
  },
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: Radius.md,
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBtn: {
    width: 72,
    height: 72,
    borderWidth: 1,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  photoCount: { ...Typography.small },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  visibilityOptions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  visibilityPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  submitWrap: { paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
  submitBtn: {
    borderRadius: 25,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontSize: 16, fontWeight: '600' as const },
});

export default function CreateMomentScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const prependMoment = useMomentsStore((s) => s.prependMoment);

  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'FRIENDS_ONLY' | 'PRIVATE'>('FRIENDS_ONLY');
  const [submitting, setSubmitting] = useState(false);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      inputBox: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      contentInput: { color: colors.text },
      photoBtn: { backgroundColor: colors.background, borderColor: colors.surfaceBorder },
      photoCount: { color: colors.textSecondary },
      rowLabel: { color: colors.text, ...Typography.bodyRegular },
      submitBtn: { backgroundColor: colors.primary },
      submitBtnDisabled: { backgroundColor: colors.surfaceBorder },
      submitText: { color: colors.white },
    }),
    [colors],
  );

  const canSubmit = content.trim().length > 0;

  const handlePickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 9 - images.length,
      quality: 0.8,
    });
    if (result.canceled) return;
    setImages((prev) => [
      ...prev,
      ...result.assets.map((a) => a.uri).slice(0, 9 - prev.length),
    ]);
  }, [images.length]);

  const handleRemoveImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const uploadedUrls: string[] = [];
      let failedUploads = 0;

      for (const uri of images) {
        try {
          const fileName = uri.split('/').pop() ?? 'photo.jpg';
          const contentType = resolveUploadContentType({ fileName }) ?? 'image/jpeg';
          const presign = await requestUploadPresign({
            filename: sanitizeUploadFilename(fileName),
            contentType,
            folder: 'posts',
          });
          await uploadLocalFileToPresignedUrl(presign.uploadUrl, contentType, uri);
          uploadedUrls.push(presign.fileUrl);
        } catch {
          failedUploads += 1;
        }
      }

      if (failedUploads > 0) {
        const reason =
          failedUploads === images.length
            ? t('moment.uploadFailed')
            : t('moment.partialUploadFailed', { count: failedUploads });
        throw new Error(reason);
      }

      const moment = await createMoment({
        content: content.trim(),
        images: uploadedUrls,
        visibility,
      });

      prependMoment(moment);
      router.back();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('moment.publishFailed');
      Alert.alert(t('moment.publishFailed'), message);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, submitting, content, images, visibility, prependMoment, router]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('moment.createTitle')} />
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[s.inputBox, d.inputBox]}>
          <TextInput
            placeholder={t('moment.contentPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            multiline
            value={content}
            onChangeText={setContent}
            maxLength={5000}
            style={[s.contentInput, d.contentInput]}
          />

          <View style={s.photoRow}>
            {images.map((uri, i) => (
              <View key={uri}>
                <Image source={{ uri }} style={s.photoThumb} contentFit="cover" />
                <Pressable
                  style={[s.removeBtn, { backgroundColor: colors.error }]}
                  onPress={() => handleRemoveImage(i)}
                >
                  <Ionicons name="close" size={12} color={colors.white} />
                </Pressable>
              </View>
            ))}
            {images.length < 9 ? (
              <Pressable style={[s.photoBtn, d.photoBtn]} onPress={handlePickImages}>
                <Ionicons name="add" size={24} color={colors.textSecondary} />
                <Text style={[s.photoCount, d.photoCount]}>{images.length}/9</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Visibility */}
        <View style={s.visibilityRow}>
          <Text style={d.rowLabel}>{t('moment.visibility')}</Text>
          <View style={s.visibilityOptions}>
            {(['FRIENDS_ONLY', 'PRIVATE'] as const).map((v) => {
              const isActive = visibility === v;
              const label = v === 'FRIENDS_ONLY' ? t('moment.friendsOnly') : t('moment.private');
              return (
                <Pressable
                  key={v}
                  onPress={() => setVisibility(v)}
                  style={[
                    s.visibilityPill,
                    {
                      backgroundColor: isActive ? colors.primary : colors.surface,
                      borderColor: isActive ? colors.primary : colors.surfaceBorder,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: isActive ? colors.white : colors.textSecondary,
                      ...Typography.caption,
                      fontWeight: '600',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={[s.submitWrap, { paddingBottom: insets.bottom || 34 }]}>
        <Pressable
          style={[s.submitBtn, canSubmit && !submitting ? d.submitBtn : d.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={[s.submitText, d.submitText]}>{t('moment.publish')}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
