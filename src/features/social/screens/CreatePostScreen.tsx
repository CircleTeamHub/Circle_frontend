import { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { OptionPickerSheet } from '@/components/ui/option-picker-sheet';
import { createPlazaPost } from '@/services/api/plaza';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';
import { useTranslation } from 'react-i18next';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

// VIP 档位对齐 app 实际会员体系（VIP1–VIP5，见 MemberCenterScreen）。
// 仅存 value，label 在组件内按当前语言生成（见 useMemo）。
const VIP_VALUES: (number | null)[] = [null, 1, 2, 3, 4, 5];
const CREDIT_VALUES: (number | null)[] = [null, 60, 70, 80, 90];

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
  const selectedCircle = usePostFormStore((s) => s.selectedCircle);
  const selectedCity = usePostFormStore((s) => s.selectedCity);
  const selectedNote = usePostFormStore((s) => s.selectedNote);
  const resetForm = usePostFormStore((s) => s.reset);

  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
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
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [activePicker, setActivePicker] = useState<
    'postExpiry' | 'signupVip' | 'signupCredit' | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  // Pattern D: 防止双击在 setSubmitting flush 之前重复触发 createPlazaPost。
  const inFlightRef = useRef(false);
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
    }),
    [colors],
  );

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

  const handleSelectCircle = useCallback(() => {
    router.push('/(tabs)/discover/select-circle');
  }, [router]);

  const handleSelectCity = useCallback(() => {
    router.push('/(tabs)/discover/select-city');
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

  const canSubmit = content.trim().length > 0 && selectedCircle != null;

  const handleSubmit = useCallback(async () => {
    if (inFlightRef.current || !canSubmit || submitting) return;
    if (!selectedCircle) return;

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const uploadedUrls: string[] = [];
      let failedUploads = 0;

      for (const uri of images) {
        try {
          const fileName = uri.split('/').pop() ?? 'photo.jpg';
          const contentType =
            resolveUploadContentType({ fileName }) ?? 'image/jpeg';
          const presign = await requestUploadPresign({
            filename: sanitizeUploadFilename(fileName),
            contentType,
            folder: 'posts',
          });
          await uploadLocalFileToPresignedUrl(
            presign.uploadUrl,
            contentType,
            uri,
          );
          uploadedUrls.push(presign.fileUrl);
        } catch (uploadError) {
          failedUploads += 1;
          if (__DEV__) {
            console.warn(
              '[CreatePostScreen] image upload failed',
              { uri },
              uploadError,
            );
          }
        }
      }

      if (failedUploads > 0) {
        const reason =
          failedUploads === images.length
            ? t('plaza.create.allUploadsFailed', {
                defaultValue: '图片上传失败，请检查网络后重试',
              })
            : t('plaza.create.partialUploadsFailed', {
                count: failedUploads,
                defaultValue: `有${failedUploads}张图片上传失败，请重试`,
              });
        throw new Error(reason);
      }

      const post = await createPlazaPost({
        content: content.trim(),
        images: uploadedUrls,
        tags: postTags,
        circleId: selectedCircle.id,
        city: selectedCity,
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
      });

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
    selectedCircle,
    images,
    content,
    postTags,
    resetForm,
    selectedCity,
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
    <View style={[d.container, { paddingTop: insets.top }]}>
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

          {/* Image picker */}
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
              <Pressable
                style={[s.photoBtn, d.photoBtn]}
                onPress={handlePickImages}
              >
                <Ionicons name="add" size={24} color={colors.textSecondary} />
                <Text style={[s.photoCount, d.photoCount]}>
                  {images.length} / 9
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
          <Switch
            value={hornEnabled}
            onValueChange={setHornEnabled}
            trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
            thumbColor={colors.white}
          />
        </View>
        <Divider />

        {/* Circle picker */}
        <MenuRow
          icon="globe-outline"
          label={t('plaza.create.selectCircle', { defaultValue: '选择圈子' })}
          rightText={
            selectedCircle?.name ??
            t('plaza.create.pleaseSelect', { defaultValue: '请选择' })
          }
          onPress={handleSelectCircle}
        />
        <Divider />

        {/* City picker */}
        <MenuRow
          icon="location-outline"
          label={t('plaza.create.selectCity', { defaultValue: '选择城市' })}
          rightText={
            selectedCity ??
            t('plaza.create.pleaseSelect', { defaultValue: '请选择' })
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
        <Divider />

        {/* Signup fancy number toggle */}
        <MenuRow
          icon="sparkles-outline"
          label={t('plaza.create.fancyRestriction', { defaultValue: '靓号限制' })}
          hasToggle
          toggleValue={signupFancyEnabled}
          onToggle={setSignupFancyEnabled}
        />
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
    </View>
  );
}
