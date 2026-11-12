import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { useTheme, Spacing, Typography, Radius, withAlpha } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import { createPlazaPost } from '@/services/api/plaza';
import { getApiErrorMessage } from '@/services/api/errors';
import { RetryIntentKeyStore } from '@/features/profile/retry-intent-key';
import { generateIdempotencyKey } from '@/utils/idempotency-key';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';
import {
  findUnavailablePostFormCircles,
  selectablePostFormCircles,
} from '@/features/discover/utils/post-form-circle-selection';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { FEATURE_FLAGS } from '@/constants/feature-flags';
import { reportHandledFailure } from '@/observability/report-failure';
import { prepareChatImageForUpload } from '@/features/chat/utils/chat-image-compress';
import { VIDEO_UPLOAD_TIMEOUT_MS } from '@/features/chat/chat-detail/constants';
import { LIMITS } from '@/constants/config';
import { mapWithConcurrency } from '@/utils/concurrency';

// VIP 档位对齐 app 实际会员体系（VIP1–VIP5，见 MemberCenterScreen）。
// 仅存 value，label 在组件内按当前语言生成（见 useMemo）。
const VIP_VALUES: (number | null)[] = [null, 1, 2, 3, 4, 5];
const CREDIT_VALUES: (number | null)[] = [null, 60, 70, 80, 90];
const POST_VIDEO_MAX_SIZE_MB = 100;

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
    minHeight: 100,
  },
  inputSpacer: { height: Spacing.md },
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
  videoThumb: {
    alignItems: 'center',
    justifyContent: 'center',
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
  tagSection: { marginTop: Spacing.md },
  tagLabel: { ...Typography.caption, marginBottom: Spacing.sm },
  sectionHeading: {
    ...Typography.caption,
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  tagInputRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  tagInput: {
    ...Typography.bodyRegular,
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
  },
  addTagBtn: {
    height: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  rowLabel: { ...Typography.bodyRegular },
  circleSection: { paddingVertical: Spacing.md, gap: Spacing.sm + 2 },
  circleHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  circleHeaderLabel: { ...Typography.body },
  circleChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  circleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    height: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  circleChipText: { ...Typography.caption, flexShrink: 1 },
  circleStatus: { alignSelf: 'flex-start' },
  circleHint: { ...Typography.caption },
  submitWrap: { paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
  submitBtn: {
    borderRadius: 25,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { fontSize: 16, fontWeight: '600' as const },
});

export default function CreatePostScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();

  const prependPlazaPost = useDiscoverStore((s) => s.prependPlazaPost);
  const fetchMyCircles = useCirclesStore((s) => s.fetchMyCircles);
  const { joinedCircles, createdCircles, myCirclesLoading, myCirclesError } = useCirclesStore(
    useShallow((s) => ({
      joinedCircles: s.joinedCircles,
      createdCircles: s.createdCircles,
      myCirclesLoading: s.myCirclesLoading,
      myCirclesError: s.myCirclesError,
    })),
  );
  useEffect(() => {
    // 先读本地快照再静默刷新，从不 reject（失败落在 myCirclesError）。
    void fetchMyCircles();
  }, [fetchMyCircles]);
  const selectedCircles = usePostFormStore((s) => s.selectedCircles);
  const selectedCities = usePostFormStore((s) => s.selectedCities);
  const selectedNote = usePostFormStore((s) => s.selectedNote);
  const setSelectedCircles = usePostFormStore((s) => s.setSelectedCircles);
  const resetForm = usePostFormStore((s) => s.reset);

  const [content, setContent] = useState('');
  const [media, setMedia] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [hornEnabled, setHornEnabled] = useState(false);
  const [postTags, setPostTags] = useState<string[]>([]);
  const [postTagInput, setPostTagInput] = useState('');
  const [signupVipRestriction, setSignupVipRestriction] = useState<
    number | null
  >(null);
  const [signupCreditRestriction, setSignupCreditRestriction] = useState<
    number | null
  >(null);
  const [signupFancyEnabled, setSignupFancyEnabled] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState(6);
  const [activePicker, setActivePicker] = useState<
    'postExpiry' | 'signupVip' | 'signupCredit' | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  // Pattern D: 防止双击在 setSubmitting flush 之前重复触发 createPlazaPost。
  const inFlightRef = useRef(false);
  // 重试同一条帖子沿用同一个幂等键(超时那次可能已经发出去了)。已传好的图片按所选
  // 条目记住、重试不再上传:每次重传 URL 都不同,请求体一变就成了「另一条帖子」。
  const [intentKeys] = useState(() => new RetryIntentKeyStore(generateIdempotencyKey));
  const uploadedMediaRef = useRef(new WeakMap<ImagePicker.ImagePickerAsset, { url: string; isVideo: boolean }>());
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      inputBox: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      contentInput: { color: colors.text },
      photoBtn: {
        backgroundColor: colors.background,
        borderColor: colors.surfaceBorder,
      },
      photoCount: { color: colors.textSecondary },
      rowLabel: { color: colors.text },
      submitBtn: { backgroundColor: colors.primary },
      submitBtnDisabled: { backgroundColor: colors.surfaceBorder },
      submitText: { color: colors.white },
      hint: { color: colors.textSecondary },
      circleChipOn: { backgroundColor: withAlpha(colors.primary, 0.12), borderColor: colors.iconAccent },
      circleChipOff: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
    }),
    [colors],
  );

  const handlePickMedia = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: LIMITS.POST_MAX_MEDIA - media.length,
        quality: 0.8,
      });
      if (result.canceled) return;
      setMedia((prev) => [
        ...prev,
        ...result.assets.slice(0, LIMITS.POST_MAX_MEDIA - prev.length),
      ]);
    } catch {
      Alert.alert(t('plaza.create.pickerFailed'), t('validation.albumPermission'));
    }
  }, [media.length, t]);

  const handleRemoveMedia = useCallback((index: number) => {
    setMedia((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 圈子直接以标签列在表单里（我创建的 + 我加入的），点一下选中 / 取消，可多选。
  const availableCircles = useMemo(
    () => selectablePostFormCircles(createdCircles, joinedCircles),
    [createdCircles, joinedCircles],
  );
  const selectedCircleIds = useMemo(
    () => new Set(selectedCircles.map((circle) => circle.id)),
    [selectedCircles],
  );
  const handleToggleCircle = useCallback(
    (circle: { id: string; name: string }) => {
      setSelectedCircles(
        selectedCircleIds.has(circle.id)
          ? selectedCircles.filter((item) => item.id !== circle.id)
          : [...selectedCircles, { id: circle.id, name: circle.name }],
      );
    },
    [selectedCircleIds, selectedCircles, setSelectedCircles],
  );

  const handleSelectCity = useCallback(() => {
    router.push({
      pathname: '/(tabs)/discover/select-city',
      params: { multiSelect: 'true', target: 'post' },
    });
  }, [router]);

  const handleSelectNote = useCallback(() => {
    router.push('/(tabs)/discover/select-note' as never);
  }, [router]);

  const closePicker = useCallback(() => setActivePicker(null), []);

  const noLimitLabel = t('plaza.create.noLimit', { defaultValue: '不限制' });

  const vipOptions = useMemo(
    () =>
      VIP_VALUES.map((value) => ({
        value,
        label:
          value === null ? noLimitLabel : `VIP ${value}`,
      })),
    [noLimitLabel],
  );
  const creditOptions = useMemo(
    () =>
      CREDIT_VALUES.map((value) => ({
        value,
        label:
          value === null
            ? noLimitLabel
            : t('plaza.create.creditAtLeast', {
                score: value,
                defaultValue: `${value}分以上`,
              }),
      })),
    [noLimitLabel, t],
  );
  const expiryOptions = useMemo(
    () => [
      {
        value: 6,
        label: t('plaza.create.expiry6h', { defaultValue: '6 小时后到期' }),
      },
      {
        value: 24,
        label: t('plaza.create.expiry24h', { defaultValue: '24 小时后到期' }),
      },
      {
        value: 72,
        label: t('plaza.create.expiry3d', { defaultValue: '3 天后到期' }),
      },
      {
        value: 168,
        label: t('plaza.create.expiry7d', { defaultValue: '7 天后到期' }),
      },
    ],
    [t],
  );

  const signupVipLabel =
    vipOptions.find((o) => o.value === signupVipRestriction)?.label ??
    noLimitLabel;
  const signupCreditLabel =
    creditOptions.find((o) => o.value === signupCreditRestriction)?.label ??
    noLimitLabel;
  const expiryLabel =
    expiryOptions.find((o) => o.value === expiresInHours)?.label ??
    expiryOptions[0].label;

  const canSubmit = content.trim().length > 0 && selectedCircles.length > 0;

  const handleSubmit = useCallback(async () => {
    if (inFlightRef.current || !canSubmit || submitting) return;
    if (selectedCircles.length === 0) return;

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const oversizedAsset = media.find((asset) => {
        const maxMb = asset.type === 'video' ? POST_VIDEO_MAX_SIZE_MB : LIMITS.IMAGE_MAX_SIZE_MB;
        return (asset.fileSize ?? 0) > maxMb * 1024 * 1024;
      });
      if (oversizedAsset) {
        Alert.alert(
          t('plaza.create.failedTitle', { defaultValue: '发布失败' }),
          t('upload.errors.fileTooLarge', {
            maxMb: oversizedAsset.type === 'video' ? POST_VIDEO_MAX_SIZE_MB : LIMITS.IMAGE_MAX_SIZE_MB,
          }),
        );
        return;
      }
      if (media.some((asset) =>
        asset.type === 'video' && !resolveUploadContentType({
          mimeType: asset.mimeType,
          fileName: asset.fileName || asset.uri.split('/').pop(),
        })?.startsWith('video/'),
      )) {
        Alert.alert(t('plaza.create.failedTitle'), t('chat.detail.videoUnsupported'));
        return;
      }

      // 发帖前用权威成员列表校验所选圈子仍可用：强制刷新一次，剔除已删除/退出的
      // 圈子。这是唯一防线，覆盖「离开圈子后未经选择页、直接在已有草稿上发帖」。
      // 判据只有「是否在成员列表里」，不做 UUID 格式假设 —— 避免误伤后端合法的
      // 非 RFC-4122 id。刷新失败时不阻断（退回后端最终校验），避免网络抖动误伤。
      const membership = await fetchMyCircles({ force: true });
      if (membership.ok) {
        const available = selectablePostFormCircles(
          membership.created,
          membership.joined,
        );
        const unavailable = findUnavailablePostFormCircles(
          selectedCircles,
          available,
        );
        if (unavailable.length > 0) {
          const unavailableIds = new Set(unavailable.map((c) => c.id));
          setSelectedCircles(
            selectedCircles.filter((c) => !unavailableIds.has(c.id)),
          );
          Alert.alert(
            t('plaza.create.invalidCircleTitle', {
              defaultValue: '请重新选择圈子',
            }),
            t('plaza.create.invalidCircleMessage', {
              defaultValue: '所选圈子已更新，请重新选择后再发布。',
            }),
          );
          return;
        }
      }

      const outcomes = await mapWithConcurrency(media, 3, async (asset) => {
        const uploaded = uploadedMediaRef.current.get(asset);
        if (uploaded) return uploaded;
        try {
          const isVideo = asset.type === 'video';
          const fileName = asset.fileName || asset.uri.split('/').pop() || (isVideo ? 'video.mp4' : 'photo.jpg');
          const contentType =
            resolveUploadContentType({
              mimeType: asset.mimeType,
              fileName,
            }) ?? (isVideo ? 'video/mp4' : 'image/jpeg');
          const source = {
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            contentType,
            filename: fileName,
          };
          const prepared = isVideo ? source : await prepareChatImageForUpload(source);
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
          const result = { url: presign.fileUrl, isVideo };
          uploadedMediaRef.current.set(asset, result);
          return result;
        } catch (uploadError) {
          reportHandledFailure('createPost', 'mediaUpload', uploadError);
          return null;
        }
      });
      const uploaded = outcomes.filter((item) => item !== null);
      const failedUploads = media.length - uploaded.length;

      if (failedUploads > 0) {
        const reason =
          failedUploads === media.length
            ? t('plaza.create.allUploadsFailed', {
                defaultValue: '媒体上传失败，请检查网络后重试',
              })
            : t('plaza.create.partialUploadsFailed', {
                count: failedUploads,
                defaultValue: `有 ${failedUploads} 个文件上传失败，请重试`,
              });
        Alert.alert(
          t('plaza.create.failedTitle', { defaultValue: '发布失败' }),
          reason,
        );
        return;
      }

      const videos = uploaded.filter((item) => item.isVideo).map((item) => item.url);
      const input = {
        content: content.trim(),
        images: uploaded.filter((item) => !item.isVideo).map((item) => item.url),
        ...(videos.length > 0 ? { videos } : {}),
        tags: postTags,
        circleIds: selectedCircles.map((c) => c.id),
        cities: selectedCities,
        noteId: selectedNote?.id ?? null,
        isHorn: hornEnabled,
        expiresInHours,
        // 查看/互动限制已合并到报名限制；这三项保留字段但一律传默认值（不限制）。
        vipRestriction: null,
        creditRestriction: null,
        fancyRestriction: false,
        signupVipRestriction,
        signupCreditRestriction,
        signupFancyRestriction: signupFancyEnabled,
      };
      const post = await intentKeys.run(JSON.stringify(input), (idempotencyKey) =>
        createPlazaPost(input, { idempotencyKey }),
      );

      prependPlazaPost(post);
      resetForm();
      router.back();
    } catch (error: unknown) {
      Alert.alert(
        t('plaza.create.failedTitle', { defaultValue: '发布失败' }),
        getApiErrorMessage(
          error,
          t('plaza.create.failedMessage', { defaultValue: '发布失败，请重试' }),
        ),
      );
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [
    canSubmit,
    submitting,
    intentKeys,
    selectedCircles,
    setSelectedCircles,
    fetchMyCircles,
    media,
    content,
    postTags,
    resetForm,
    selectedCities,
    selectedNote,
    hornEnabled,
    expiresInHours,
    signupVipRestriction,
    signupCreditRestriction,
    signupFancyEnabled,
    prependPlazaPost,
    router,
    t,
  ]);

  return (
    <KeyboardAvoidingContainer style={[d.container, { paddingTop: insets.top }]}>
      {/* rightIcon 之前没 onRightPress —— 是哑按钮。先去掉，等"发布须知"页面 wire 上时再加。 */}
      <NavHeader title={t('plaza.create.title', { defaultValue: '发布动态' })} />
      <ScrollView
        style={s.scroll}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        <View style={[s.inputBox, d.inputBox]}>
          <TextInput
            placeholder={t('plaza.create.contentPlaceholder', {
              defaultValue: '请输入详细内容',
            })}
            placeholderTextColor={colors.textSecondary}
            multiline
            value={content}
            onChangeText={setContent}
            style={[s.contentInput, d.contentInput]}
            maxLength={5000}
          />
          <View style={s.inputSpacer} />

          {/* Media picker */}
          <View style={s.photoRow}>
            {media.map((asset, i) => (
              <View key={`${asset.uri}-${i}`}>
                {asset.type === 'video' ? (
                  <View style={[s.photoThumb, s.videoThumb, { backgroundColor: colors.textSecondary }]}>
                    <Ionicons name="videocam" size={28} color={colors.white} />
                  </View>
                ) : (
                  <Image source={{ uri: asset.uri }} style={s.photoThumb} contentFit="cover" />
                )}
                <Pressable
                  style={[s.removeBtn, { backgroundColor: colors.error }]}
                  onPress={() => handleRemoveMedia(i)}
                  accessibilityLabel={t('moment.removeMedia')}
                >
                  <Ionicons name="close" size={12} color={colors.white} />
                </Pressable>
              </View>
            ))}
            {media.length < LIMITS.POST_MAX_MEDIA ? (
              <Pressable
                style={[s.photoBtn, d.photoBtn]}
                onPress={handlePickMedia}
                accessibilityLabel={t('moment.selectMedia')}
              >
                <Ionicons name="add" size={24} color={colors.textSecondary} />
                <Text style={[s.photoCount, d.photoCount]}>
                  {media.length} / {LIMITS.POST_MAX_MEDIA}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Horn toggle */}
        <View style={s.toggleRow}>
          <Text style={[s.rowLabel, d.rowLabel]}>
            {t('plaza.create.hornLabel', { defaultValue: '喇叭动态' })}
          </Text>
          <ThemedSwitch
            value={hornEnabled}
            onValueChange={setHornEnabled}
          />
        </View>
        <Divider />

        {/* 圈子（多选）：不再跳选择页，参加的圈子直接以标签列出，点标签即选中 / 取消。 */}
        <View style={s.circleSection}>
          <View style={s.circleHeader}>
            <Ionicons name="globe-outline" size={20} color={colors.text} />
            <Text style={[s.circleHeaderLabel, d.rowLabel]}>
              {t('plaza.create.selectCircle', { defaultValue: '选择圈子' })}
            </Text>
          </View>
          {availableCircles.length > 0 ? (
            <View style={s.circleChipRow}>
              {availableCircles.map((circle) => {
                const selected = selectedCircleIds.has(circle.id);
                return (
                  <Pressable
                    key={circle.id}
                    style={[s.circleChip, selected ? d.circleChipOn : d.circleChipOff]}
                    onPress={() => handleToggleCircle(circle)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={circle.name}
                    accessibilityState={{ checked: selected }}
                  >
                    {selected ? (
                      <Ionicons name="checkmark" size={14} color={colors.iconAccent} />
                    ) : null}
                    <Text
                      style={[s.circleChipText, { color: selected ? colors.iconAccent : colors.text }]}
                      numberOfLines={1}
                    >
                      {circle.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : myCirclesLoading ? (
            <ActivityIndicator color={colors.iconAccent} style={s.circleStatus} />
          ) : myCirclesError ? (
            <Pressable
              style={s.circleStatus}
              onPress={() => void fetchMyCircles({ force: true })}
              accessibilityRole="button"
            >
              <Text style={[s.circleHint, d.hint]}>
                {myCirclesError} · {t('common.retry')}
              </Text>
            </Pressable>
          ) : (
            <Text style={[s.circleHint, s.circleStatus, d.hint]}>{t('plaza.noCirclesJoined')}</Text>
          )}
        </View>
        <Divider />

        {/* City picker（多选） */}
        <MenuRow
          icon="location-outline"
          label={t('plaza.create.selectCity', { defaultValue: '选择城市' })}
          rightText={
            selectedCities.length > 0
              ? selectedCities.join('、')
              : t('plaza.create.pleaseSelect', { defaultValue: '请选择' })
          }
          onPress={handleSelectCity}
        />
        <Divider />

        <MenuRow
          icon="time-outline"
          label={t('plaza.create.expiryLabel', { defaultValue: '帖子到期时间' })}
          rightText={expiryLabel}
          onPress={() => setActivePicker('postExpiry')}
        />
        <Divider />

        <MenuRow
          icon="document-text-outline"
          label={t('plaza.create.noteLabel', { defaultValue: '选择笔记' })}
          rightText={
            selectedNote?.title ??
            t('plaza.create.notNoteSet', { defaultValue: '不添加' })
          }
          onPress={handleSelectNote}
        />
        <Divider />

        {/* Post tags */}
        <View style={s.tagSection}>
          <Text style={[s.tagLabel, { color: colors.textSecondary }]}>
            {t('plaza.create.tagsLabel', {
              max: 5,
              defaultValue: '关键词标签（最多5个）',
            })}
          </Text>
          <View style={s.tagRow}>
            {postTags.map((tag, i) => (
              <Pressable
                key={tag}
                onPress={() => setPostTags(postTags.filter((_, idx) => idx !== i))}
                style={[s.tagChip, { backgroundColor: colors.primary }]}
              >
                <Text style={{ color: colors.white, ...Typography.caption }}>#{tag}</Text>
                <Ionicons name="close" size={12} color={colors.white} />
              </Pressable>
            ))}
          </View>
          {postTags.length < 5 ? (
            <View style={s.tagInputRow}>
              <TextInput
                placeholder={t('plaza.create.tagPlaceholder', {
                  defaultValue: '输入标签关键词',
                })}
                placeholderTextColor={colors.textSecondary}
                value={postTagInput}
                onChangeText={setPostTagInput}
                onSubmitEditing={() => {
                  const tag = postTagInput.trim();
                  if (tag && !postTags.includes(tag)) {
                    setPostTags([...postTags, tag]);
                    setPostTagInput('');
                  }
                }}
                maxLength={15}
                style={[s.tagInput, { borderColor: colors.surfaceBorder, color: colors.text, backgroundColor: colors.surface }]}
              />
              <Pressable
                onPress={() => {
                  const tag = postTagInput.trim();
                  if (tag && !postTags.includes(tag)) {
                    setPostTags([...postTags, tag]);
                    setPostTagInput('');
                  }
                }}
                style={[s.addTagBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={{ color: colors.white, ...Typography.caption }}>
                  {t('plaza.create.addTag', { defaultValue: '添加' })}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        <Divider />

        {/* 报名限制 —— 以下三项都绑定 signup* 字段，控制谁能报名 */}
        <Text style={[s.sectionHeading, { color: colors.textSecondary }]}>
          {t('plaza.create.signupRestrictions', { defaultValue: '报名限制' })}
        </Text>

        {/* Signup VIP restriction */}
        <MenuRow
          icon="diamond-outline"
          label={t('plaza.create.vipRestriction', { defaultValue: 'VIP限制' })}
          rightText={signupVipLabel}
          onPress={() => setActivePicker('signupVip')}
        />
        <Divider />

        {/* Signup credit restriction */}
        <MenuRow
          icon="shield-checkmark-outline"
          label={t('plaza.create.creditRestriction', {
            defaultValue: '信用值限制',
          })}
          rightText={signupCreditLabel}
          onPress={() => setActivePicker('signupCredit')}
        />
        {FEATURE_FLAGS.fancyNumbers ? (
          <>
            <Divider />
            {/* Signup fancy number toggle */}
            <MenuRow
              icon="sparkles-outline"
              label={t('plaza.create.fancyRestriction', { defaultValue: '靓号限制' })}
              hasToggle
              toggleValue={signupFancyEnabled}
              onToggle={setSignupFancyEnabled}
            />
          </>
        ) : null}
      </ScrollView>

      <OptionPickerSheet
        visible={activePicker === 'postExpiry'}
        title={t('plaza.create.expiryPickerTitle', {
          defaultValue: '选择帖子到期时间',
        })}
        options={expiryOptions}
        selectedValue={expiresInHours}
        onSelect={setExpiresInHours}
        onClose={closePicker}
      />
      <OptionPickerSheet
        visible={activePicker === 'signupVip'}
        title={t('plaza.create.vipPickerTitle', {
          defaultValue: '选择 VIP 限制',
        })}
        options={vipOptions}
        selectedValue={signupVipRestriction}
        onSelect={setSignupVipRestriction}
        onClose={closePicker}
      />
      <OptionPickerSheet
        visible={activePicker === 'signupCredit'}
        title={t('plaza.create.creditPickerTitle', {
          defaultValue: '选择信用值限制',
        })}
        options={creditOptions}
        selectedValue={signupCreditRestriction}
        onSelect={setSignupCreditRestriction}
        onClose={closePicker}
      />

      <View style={[s.submitWrap, { paddingBottom: insets.bottom || 34 }]}>
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
              {t('plaza.create.submit', { defaultValue: '提交' })}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingContainer>
  );
}
