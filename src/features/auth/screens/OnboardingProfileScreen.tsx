import { useState } from 'react';
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
import { router } from 'expo-router';
import type { ImagePickerAsset } from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { CityPickerSheet } from '@/features/auth/components/CityPickerSheet';
import { useOnboardingStyles } from '@/features/auth/hooks/use-onboarding-styles';
import {
  toProfileUpdatePayload,
  validateProfileFieldValue,
} from '@/features/profile/profile-edit-config';
import {
  getAvatarPickerPermissionDeniedMessage,
} from '@/features/profile/avatar-picker-feedback';
import {
  launchImageLibraryFast,
  loadImagePickerModule,
} from '@/features/profile/image-picker';
import { getCropLibraryPickerOptions, useImageCropStep } from '@/features/profile/image-crop-step';
import { getApiErrorMessage } from '@/services/api/errors';
import { updateUserProfile, type UpdateProfilePayload } from '@/services/api/profile';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { prepareChatImageForUpload } from '@/features/chat/utils/chat-image-compress';
import { useEagerMediaUploads } from '@/features/discover/hooks/use-eager-media-uploads';
import { NoteMediaUploadRing } from '@/features/notes/components/NoteMediaUploadRing';
import { reportHandledFailure } from '@/observability/report-failure';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { useAuthStore } from '@/stores/authStore';
import { useKnownAccountsStore } from '@/stores/knownAccountsStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const AVATAR_SIZE = 112;

/**
 * 头像选中(裁剪完)就开始传(见 useEagerMediaUploads),填昵称、简介的同时字节已经在走,
 * 点「完成」不用再从头等。先和聊天、动态一样压到长边 2048。
 */
async function uploadOnboardingAvatar(asset: ImagePickerAsset, progressKey: string): Promise<string> {
  const fileName = asset.fileName ?? 'avatar.jpg';
  const contentType =
    resolveUploadContentType({ mimeType: asset.mimeType, fileName }) ?? 'image/jpeg';
  const prepared = await prepareChatImageForUpload({
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    contentType,
    filename: fileName,
  });
  const { uploadUrl, fileUrl, requiredHeaders } = await requestUploadPresign({
    filename: sanitizeUploadFilename(prepared.filename),
    contentType: prepared.contentType,
    folder: 'avatars',
    fileUri: prepared.uri,
  });
  await uploadLocalFileToPresignedUrl(
    uploadUrl,
    prepared.contentType,
    prepared.uri,
    requiredHeaders,
    undefined,
    { progressKey, foreground: true },
  );
  return fileUrl;
}

function reportOnboardingAvatarUploadFailure(error: unknown) {
  reportHandledFailure('onboardingProfile', 'avatarUpload', error);
}

const s = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  header: {
    gap: Spacing.xs,
  },
  avatarBlock: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  avatarPreview: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: 'hidden',
  },
  avatarFailedOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  fieldBlock: {
    gap: Spacing.sm,
  },
  label: {
    ...Typography.small,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 52,
    textAlignVertical: 'top',
  },
  selectInput: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    minHeight: 52,
  },
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  selectText: {
    flex: 1,
  },
  optionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  optionChip: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  button: {
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

type GenderOption = {
  value: 'female' | 'male' | 'other' | 'unset';
  labelKey: string;
};

const GENDER_OPTIONS: GenderOption[] = [
  { value: 'female', labelKey: 'profileFields.female' },
  { value: 'male', labelKey: 'profileFields.male' },
  { value: 'other', labelKey: 'profileFields.other' },
  { value: 'unset', labelKey: 'profileFields.genderNotSet' },
];

function startAppServicesAfterOnboarding() {
  // chat 长连接由 SessionBootstrap 在 onboardingRequired 翻 false 后自动建立；
  // 这里只补拉会话分组（MessagesScreen 顶部 filter tab 需要）。
  void useMessageGroupsStore.getState().load();
}

export default function OnboardingProfileScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const setOnboardingRequired = useAuthStore(
    (state) => state.setOnboardingRequired,
  );
  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [bio, setBio] = useState(user?.persona ?? '');
  const [city, setCity] = useState(user?.city ?? '');
  const [isCityPickerVisible, setIsCityPickerVisible] = useState(false);
  const [gender, setGender] = useState(user?.gender ?? 'unset');
  const {
    items: avatarItems,
    add: addAvatar,
    remove: removeAvatar,
    retry: retryAvatar,
    settle: settleAvatar,
  } = useEagerMediaUploads({
    upload: uploadOnboardingAvatar,
    onError: reportOnboardingAvatarUploadFailure,
  });
  const pickedAvatar = avatarItems[0] ?? null;
  const [isSaving, setIsSaving] = useState(false);

  const avatarPreviewUri = pickedAvatar?.asset.uri ?? user?.avatarUrl ?? null;
  const d = useOnboardingStyles();

  const { cropIfNeeded, cropper: avatarCropper } = useImageCropStep('square');

  async function handlePickAvatar() {
    const imagePicker = loadImagePickerModule();

    if (!imagePicker) {
      Alert.alert(
        t('validation.cannotSelectImage'),
        t('validation.imagePickerNotAvailable'),
      );
      return;
    }

    // 上传前让用户确认头像裁剪；iOS 选完后走应用内裁剪，保持相册秒开。
    const outcome = await launchImageLibraryFast(imagePicker, {
      quality: 0.8,
      mediaTypes: ['images'],
      ...getCropLibraryPickerOptions('square'),
    });
    if (outcome.status === 'denied') {
      const message =
        getAvatarPickerPermissionDeniedMessage(outcome.permission) ??
        t('validation.albumPermission');
      Alert.alert(t('validation.cannotSelectImage'), message);
      return;
    }
    const { result } = outcome;

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = await cropIfNeeded(result.assets[0]);
    if (!asset) return;
    const contentType = resolveUploadContentType({
      mimeType: asset.mimeType,
      fileName: asset.fileName,
    });

    if (!contentType) {
      Alert.alert(
        t('validation.cannotSelectImage'),
        t('validation.unsupportedImageFormat'),
      );
      return;
    }

    const maxAvatarBytes = 10 * 1024 * 1024;
    if (asset.fileSize && asset.fileSize > maxAvatarBytes) {
      Alert.alert(t('validation.imageTooLarge'), t('validation.imageSizeLimit'));
      return;
    }

    avatarItems.forEach((item) => removeAvatar(item.id));
    addAvatar([asset], 1);
  }

  function getValidationError() {
    if (!avatarPreviewUri) {
      return t('validation.avatarRequired');
    }

    for (const [fieldId, value] of [
      ['nickname', nickname],
      ['bio', bio],
      ['city', city],
      ['gender', gender],
    ] as const) {
      const error = validateProfileFieldValue(fieldId, value);
      if (error) return error;
    }

    return null;
  }

  function handleConfirmCity(nextCity: string) {
    setCity(nextCity);
    setIsCityPickerVisible(false);
  }

  async function handleSubmit() {
    if (!user || isSaving) {
      return;
    }

    const validationError = getValidationError();
    if (validationError) {
      Alert.alert(t('validation.cannotSave'), validationError);
      return;
    }

    setIsSaving(true);

    try {
      const payload: UpdateProfilePayload = {
        nickname: nickname.trim(),
        persona: bio.trim(),
        city: city.trim(),
        ...toProfileUpdatePayload('gender', gender),
      };

      if (pickedAvatar) {
        // 头像选中时就开始传了，这里只等它传完；失败的会补传一次。
        const settled = await settleAvatar();
        if (!settled.ok) {
          Alert.alert(
            t('validation.saveFailed'),
            getApiErrorMessage(settled.error, t('validation.saveFailed')),
          );
          return;
        }
        payload.avatarUrl = settled.results[0];
      }

      const nextUser = await updateUserProfile(user.id, payload, user);
      setUser(nextUser);
      const { accessToken, refreshToken } = useAuthStore.getState();
      if (accessToken && refreshToken) {
        useKnownAccountsStore.getState().upsertAccount({
          user: nextUser,
          accessToken,
          refreshToken,
          updatedAt: Date.now(),
        });
      }
      setOnboardingRequired(false);
      // 命令式直接跳到最终目的地，和登录成功后的 onAuthSuccess 走同一条路径。
      router.replace('/(tabs)/messages');
      startAppServicesAfterOnboarding();
    } catch (error) {
      const message = getApiErrorMessage(error, t('validation.saveFailed'));
      Alert.alert(t('validation.saveFailed'), message);
    } finally {
      setIsSaving(false);
    }
  }

  if (!user) {
    return (
      <View style={[s.loading, d.page]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingContainer
      style={[s.page, d.page, { paddingTop: insets.top }]}
    >
      <ScrollView
        contentContainerStyle={[
          s.content,
          { paddingTop: Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
        ]}
        {...keyboardDismissOnDragProps}
      >
        <View style={s.header}>
          <Text style={d.title}>{t('onboarding.profileTitle')}</Text>
          <Text style={d.subtitle}>{t('onboarding.profileSubtitle')}</Text>
        </View>

        <View style={s.avatarBlock}>
          <View style={s.avatarPreview}>
            <Avatar
              size={AVATAR_SIZE}
              name={nickname || user.accountId || 'C'}
              uri={avatarPreviewUri ?? undefined}
            />
            {pickedAvatar?.status === 'uploading' ? (
              <NoteMediaUploadRing progressKey={pickedAvatar.id} />
            ) : null}
            {pickedAvatar?.status === 'failed' ? (
              <Pressable
                style={[s.avatarFailedOverlay, { backgroundColor: colors.overlay }]}
                onPress={() => retryAvatar(pickedAvatar.id)}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
              >
                <Ionicons name="refresh" size={28} color={colors.white} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            style={[s.avatarButton, d.avatarButton]}
            onPress={handlePickAvatar}
            disabled={isSaving}
          >
            <Ionicons name="image-outline" size={18} color={colors.text} />
            <Text style={d.avatarButtonText}>
              {t('profileFields.selectFromAlbum')}
            </Text>
          </Pressable>
        </View>

        <View style={s.fieldBlock}>
          <Text style={[s.label, d.label]}>{t('profileFields.nickname')}</Text>
          <TextInput
            value={nickname}
            onChangeText={setNickname}
            placeholder={t('profileFields.nicknamePlaceholder')}
            placeholderTextColor={colors.textSecondary}
            style={[s.input, d.input]}
            autoCapitalize="none"
            maxLength={24}
          />
        </View>

        <View style={s.fieldBlock}>
          <Text style={[s.label, d.label]}>{t('profileFields.bio')}</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder={t('profileFields.bioPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            style={[s.input, d.input, { minHeight: 112 }]}
            multiline
            maxLength={200}
          />
        </View>

        <View style={s.fieldBlock}>
          <Text style={[s.label, d.label]}>{t('profileFields.gender')}</Text>
          <View style={s.optionRow}>
            {GENDER_OPTIONS.map((option) => {
              const isActive = gender === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[
                    s.optionChip,
                    d.optionChip,
                    isActive ? d.optionChipActive : null,
                  ]}
                  onPress={() => setGender(option.value)}
                  disabled={isSaving}
                >
                  <Text
                    style={[
                      d.optionText,
                      isActive ? d.optionTextActive : null,
                    ]}
                  >
                    {t(option.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={s.fieldBlock}>
          <Text style={[s.label, d.label]}>{t('profileFields.city')}</Text>
          <Pressable
            style={[s.selectInput, s.selectField, d.selectInput]}
            onPress={() => setIsCityPickerVisible(true)}
            disabled={isSaving}
          >
            <Text
              style={[
                s.selectText,
                d.selectText,
                city.trim() ? null : d.selectPlaceholder,
              ]}
              numberOfLines={1}
            >
              {city.trim() || t('profileFields.cityPlaceholder')}
            </Text>
            <Ionicons
              name="chevron-down"
              size={18}
              color={colors.textSecondary}
            />
          </Pressable>
        </View>

        <Pressable
          style={[s.button, d.button, isSaving ? { opacity: 0.6 } : null]}
          onPress={handleSubmit}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={d.buttonText}>{t('onboarding.finish')}</Text>
          )}
        </Pressable>
      </ScrollView>
      <CityPickerSheet
        visible={isCityPickerVisible}
        initialCity={city}
        onClose={() => setIsCityPickerVisible(false)}
        onConfirm={handleConfirmCity}
      />
      {avatarCropper}
    </KeyboardAvoidingContainer>
  );
}
