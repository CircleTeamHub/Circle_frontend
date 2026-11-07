import { useState, useCallback, useMemo, useRef } from 'react';
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
import { getApiErrorMessage } from '@/services/api/errors';
import { createMoment } from '@/services/api/moments';
import { RetryIntentKeyStore } from '@/features/profile/retry-intent-key';
import { generateIdempotencyKey } from '@/utils/idempotency-key';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useMomentsStore } from '@/features/discover/store/use-moments-store';
import { mapWithConcurrency } from '@/utils/concurrency';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { reportHandledFailure } from '@/observability/report-failure';
import { prepareChatImageForUpload } from '@/features/chat/utils/chat-image-compress';
import { LIMITS } from '@/constants/config';
import { uploadChatVideoPoster } from '@/features/chat/utils/chat-video-poster';
import { VIDEO_UPLOAD_TIMEOUT_MS } from '@/features/chat/chat-detail/constants';
import type { MomentAttachmentInput } from '@/types';

// /upload/presign currently caps videos at 100 MiB.
const MOMENT_VIDEO_MAX_SIZE_MB = 100;

type UploadedMomentMedia = { attachment: MomentAttachmentInput; url: string };

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
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [visibility, setVisibility] = useState<'FRIENDS_ONLY' | 'PRIVATE'>('FRIENDS_ONLY');
  const [submitting, setSubmitting] = useState(false);
  // state 要等下一次渲染才生效,连点两下都会以 submitting=false 进来:ref 在入口同步拦。
  const inFlightRef = useRef(false);
  // 重试同一条动态沿用同一个幂等键(超时那次可能已经发出去了)。已传好的媒体按所选
  // 条目记住、重试不再上传:每次重传 key 都不同,请求体一变就成了「另一条动态」。
  const [intentKeys] = useState(() => new RetryIntentKeyStore(generateIdempotencyKey));
  const uploadedMediaRef = useRef(new Map<ImagePicker.ImagePickerAsset, UploadedMomentMedia>());

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
    const remaining = LIMITS.POST_MAX_MEDIA - images.length;
    if (remaining <= 0) return;
    // review 修复：先开 picker、失败才引导（#109 的门禁反了）。iOS PHPicker /
    // Android 13+ 系统 photo picker 无需相册权限即可返回所选图片 —— 前置的
    // 相册权限请求会把「曾拒绝过广义相册权限」的用户挡在一个本不需要权限的
    // 入口外。仅当 launch 本身失败（老系统真的要权限）时再提示去设置。
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: remaining,
        quality: 0.8,
      });
      if (result.canceled) return;
      setImages((prev) => [
        ...prev,
        ...result.assets.slice(0, LIMITS.POST_MAX_MEDIA - prev.length),
      ]);
    } catch {
      Alert.alert(
        t('validation.cannotSelectImage'),
        t('validation.albumPermission'),
      );
    }
  }, [images.length, t]);

  const handleRemoveImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting || inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const hasOversizedImage = images.some(
        (asset) =>
          asset.type !== 'video' &&
          typeof asset.fileSize === 'number' &&
          asset.fileSize > LIMITS.IMAGE_MAX_SIZE_MB * 1024 * 1024,
      );
      if (hasOversizedImage) {
        Alert.alert(
          t('moment.publishFailed'),
          t('upload.errors.fileTooLarge', {
            maxMb: LIMITS.IMAGE_MAX_SIZE_MB,
          }),
        );
        return;
      }
      if (images.some((asset) => asset.type === 'video' && typeof asset.fileSize === 'number' && asset.fileSize > MOMENT_VIDEO_MAX_SIZE_MB * 1024 * 1024)) {
        Alert.alert(t('moment.publishFailed'), t('upload.errors.fileTooLarge', { maxMb: MOMENT_VIDEO_MAX_SIZE_MB }));
        return;
      }

      // 并发上传，cap=3（#108）：串行九图最坏 ~18s；全量并发又会同时打满
      // presign + S3 PUT。per-item 失败就地吞掉记 null，序号与所选图片一一对应。
      const outcomes = await mapWithConcurrency(images, 3, async (asset): Promise<UploadedMomentMedia | null> => {
        const uploaded = uploadedMediaRef.current.get(asset);
        if (uploaded) return uploaded;
        try {
          const isVideo = asset.type === 'video';
          const fileName = asset.fileName ?? (asset.uri.split('/').pop() || (isVideo ? 'video.mp4' : 'photo.jpg'));
          const contentType =
            resolveUploadContentType({
              mimeType: asset.mimeType,
              fileName,
            }) ?? (isVideo ? 'video/mp4' : 'image/jpeg');
          const input = {
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            contentType,
            filename: fileName,
          };
          const prepared = isVideo ? input : await prepareChatImageForUpload(input);
          const presign = await requestUploadPresign({
            filename: sanitizeUploadFilename(prepared.filename),
            contentType: prepared.contentType,
            folder: 'posts',
            fileUri: prepared.uri,
          });
          await uploadLocalFileToPresignedUrl(
            presign.uploadUrl,
            prepared.contentType,
            prepared.uri,
            presign.requiredHeaders,
            isVideo ? VIDEO_UPLOAD_TIMEOUT_MS : undefined,
          );
          const duration = typeof asset.duration === 'number' ? asset.duration / 1000 : undefined;
          const poster = isVideo ? await uploadChatVideoPoster(asset.uri, duration, fileName, 'posts') : null;
          const result: UploadedMomentMedia = {
            url: presign.fileUrl,
            attachment: {
              type: isVideo ? 'video' : 'image',
              key: presign.key,
              ...(poster ? { posterKey: poster.key } : {}),
              ...((prepared.width ?? 0) > 0 ? { width: prepared.width } : {}),
              ...((prepared.height ?? 0) > 0 ? { height: prepared.height } : {}),
              ...(isVideo && duration !== undefined ? { duration } : {}),
            },
          };
          uploadedMediaRef.current.set(asset, result);
          return result;
        } catch (error) {
          reportHandledFailure('moments', 'mediaUpload', error);
          return null;
        }
      });
      const uploaded = outcomes.filter(
        (item): item is NonNullable<typeof item> => item !== null,
      );
      const failedUploads = images.length - uploaded.length;

      if (failedUploads > 0) {
        const reason =
          failedUploads === images.length
            ? t('moment.uploadFailed')
            : t('moment.partialUploadFailed', { count: failedUploads });
        Alert.alert(t('moment.publishFailed'), reason);
        return;
      }

      const input = {
        content: content.trim(),
        images: uploaded.filter((item) => item.attachment.type === 'image').map((item) => item.url),
        attachments: uploaded.map((item) => item.attachment),
        visibility,
      };
      const moment = await intentKeys.run(JSON.stringify(input), (idempotencyKey) =>
        createMoment(input, { idempotencyKey }),
      );

      prependMoment(moment);
      router.back();
    } catch (error: unknown) {
      const message = getApiErrorMessage(error, t('moment.publishFailed'));
      Alert.alert(t('moment.publishFailed'), message);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [canSubmit, submitting, intentKeys, content, images, visibility, prependMoment, router, t]);

  return (
    <KeyboardAvoidingContainer
      testID={E2E_TEST_IDS.momentCreateScreen}
      style={[d.container, { paddingTop: insets.top }]}
    >
      <NavHeader title={t('moment.createTitle')} />
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        <View style={[s.inputBox, d.inputBox]}>
          <TextInput
            testID={E2E_TEST_IDS.momentContentInput}
            placeholder={t('moment.contentPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            multiline
            value={content}
            onChangeText={setContent}
            maxLength={5000}
            style={[s.contentInput, d.contentInput]}
          />

          <View style={s.photoRow}>
            {images.map((asset, i) => (
              <View key={`${asset.uri}-${i}`}>
                {asset.type === 'video' ? (
                  <View style={[s.photoThumb, { backgroundColor: colors.textSecondary, alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name="videocam" size={28} color={colors.white} />
                  </View>
                ) : <Image source={{ uri: asset.uri }} style={s.photoThumb} contentFit="cover" />}
                <Pressable
                  style={[s.removeBtn, { backgroundColor: colors.error }]}
                  onPress={() => handleRemoveImage(i)}
                  accessibilityLabel={t('moment.removeMedia', { defaultValue: '移除图片或视频' })}
                >
                  <Ionicons name="close" size={12} color={colors.white} />
                </Pressable>
              </View>
            ))}
            {images.length < LIMITS.POST_MAX_MEDIA ? (
              <Pressable style={[s.photoBtn, d.photoBtn]} onPress={handlePickImages} accessibilityLabel={t('moment.selectMedia', { defaultValue: '添加图片或视频' })}>
                <Ionicons name="add" size={24} color={colors.textSecondary} />
                <Text style={[s.photoCount, d.photoCount]}>{images.length}/{LIMITS.POST_MAX_MEDIA}</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={[s.photoCount, d.photoCount]}>
            {t('moment.mediaLimitHint', { max: LIMITS.POST_MAX_MEDIA, defaultValue: '图片和视频合计最多 {{max}} 个' })}
          </Text>
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
          testID={E2E_TEST_IDS.momentPublish}
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
    </KeyboardAvoidingContainer>
  );
}
