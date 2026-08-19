import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import { Avatar } from '@/components/ui/avatar';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { NavHeader } from '@/components/ui/nav-header';
import { updateUserProfile } from '@/services/api/profile';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import {
  formatProfileFieldValue,
  getProfileEditField,
  toProfileUpdatePayload,
  validateProfileFieldValue,
} from '@/features/profile/profile-edit-config';
import {
  CITY_PROVINCES,
  findProvinceByCity,
} from '@/features/profile/city-options';
import { loadImagePickerModule } from '@/features/profile/image-picker';
import {
  getAvatarPickerPermissionDeniedMessage,
} from '@/features/profile/avatar-picker-feedback';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

const s = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  fieldBlock: {
    gap: Spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 52,
    textAlignVertical: 'top',
  },
  footer: {
    marginTop: 'auto',
    paddingBottom: Spacing.lg,
  },
  button: {
    height: 52,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarEditor: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatarButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  optionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  optionChip: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateField: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
  },
  modalCard: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerColumns: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  pickerColumn: {
    flex: 1,
    gap: Spacing.xs,
  },
  pickerList: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    maxHeight: 260,
  },
  pickerItem: {
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function parseBirthdayValue(value: string) {
  const today = new Date();
  const fallback = {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    day: today.getDate(),
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }

  const [yearText, monthText, dayText] = value.split('-');
  return {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
  };
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export default function EditProfileFieldScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ field?: string }>();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [isSaving, setIsSaving] = useState(false);
  const [isBirthdayPickerVisible, setIsBirthdayPickerVisible] = useState(false);
  const [isCityPickerVisible, setIsCityPickerVisible] = useState(false);
  const [selectedAvatarUri, setSelectedAvatarUri] = useState<string | null>(null);
  const [selectedAvatarFileName, setSelectedAvatarFileName] = useState<string | null>(null);
  const [selectedAvatarMimeType, setSelectedAvatarMimeType] = useState<string | null>(null);

  const field = getProfileEditField(
    typeof params.field === 'string' ? params.field : '',
  );

  const initialValue = useMemo(() => {
    if (!field || !field.editable || !user) {
      return '';
    }

    const value = user[field.valueKey];
    return typeof value === 'string' ? value : '';
  }, [field, user]);

  const [value, setValue] = useState(initialValue);
  const [birthdayDraft, setBirthdayDraft] = useState(() =>
    parseBirthdayValue(initialValue),
  );
  const [cityDraftRegion, setCityDraftRegion] = useState(() =>
    findProvinceByCity(initialValue).name,
  );
  const [cityDraftValue, setCityDraftValue] = useState(() => initialValue.trim());

  const birthdayDays = useMemo(
    () =>
      Array.from(
        { length: getDaysInMonth(birthdayDraft.year, birthdayDraft.month) },
        (_, index) => index + 1,
      ),
    [birthdayDraft.month, birthdayDraft.year],
  );
  const birthdayYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1949 }, (_, index) => currentYear - index);
  }, []);
  const genderOptions = [
    t('profileFields.male'),
    t('profileFields.female'),
    t('profileFields.genderNotSet'),
  ];
  const cityRegion = useMemo(
    () =>
      CITY_PROVINCES.find((region) => region.name === cityDraftRegion) ??
      CITY_PROVINCES[0],
    [cityDraftRegion],
  );
  const cityOptions = cityRegion.cities;
  const avatarPreviewUri = selectedAvatarUri ?? initialValue ?? null;

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      input: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
        color: colors.text,
        ...Typography.bodyRegular,
      },
      button: {
        backgroundColor: colors.primary,
      },
      buttonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      fallbackTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      fallbackText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      optionChip: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      optionChipActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
      },
      optionChipText: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '500' as const,
      },
      optionChipTextActive: {
        color: colors.white,
      },
      dateField: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      dateFieldText: {
        color: colors.text,
        ...Typography.bodyRegular,
      },
      modalBackdrop: {
        backgroundColor: colors.overlay,
      },
      modalCard: {
        backgroundColor: colors.background,
      },
      modalTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      pickerList: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      pickerItemText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      pickerItemTextActive: {
        color: colors.primary,
        fontWeight: '700' as const,
      },
      actionText: {
        color: colors.primary,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      avatarButton: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      avatarButtonText: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  async function handlePickAvatar() {
    const imagePicker = loadImagePickerModule();

    if (!imagePicker) {
      Alert.alert(
        t('validation.cannotSelectImage'),
        t('validation.imagePickerNotAvailable'),
      );
      return;
    }

    const permission =
      await imagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      const message =
        getAvatarPickerPermissionDeniedMessage(permission) ??
        t('validation.albumPermission');
      Alert.alert(t('validation.cannotSelectImage'), message);
      return;
    }

    const result = await imagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      mediaTypes: ['images'],
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    const contentType = resolveUploadContentType({
      mimeType: asset.mimeType,
      fileName: asset.fileName,
    });

    if (!contentType) {
      Alert.alert(t('validation.cannotSelectImage'), t('validation.unsupportedImageFormat'));
      return;
    }

    const MAX_AVATAR_BYTES = 10 * 1024 * 1024; // 10 MB
    if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
      Alert.alert(t('validation.imageTooLarge'), t('validation.imageSizeLimit'));
      return;
    }

    setSelectedAvatarUri(asset.uri);
    setSelectedAvatarFileName(asset.fileName ?? 'avatar.jpg');
    setSelectedAvatarMimeType(contentType);
  }

  async function handleSave() {
    if (!field || !field.editable || !user || isSaving) {
      return;
    }

    if (field.id === 'avatar') {
      if (!selectedAvatarUri || !selectedAvatarMimeType) {
        Alert.alert(t('validation.cannotSave'), t('validation.avatarRequired'));
        return;
      }

      setIsSaving(true);

      try {
        const filename = sanitizeUploadFilename(
          selectedAvatarFileName ?? 'avatar.jpg',
        );
        const { uploadUrl, fileUrl } = await requestUploadPresign({
          filename,
          contentType: selectedAvatarMimeType,
          folder: 'avatars',
          fileUri: selectedAvatarUri,
        });

        await uploadLocalFileToPresignedUrl(
          uploadUrl,
          selectedAvatarMimeType,
          selectedAvatarUri,
        );

        const nextUser = await updateUserProfile(user.id, {
          avatarUrl: fileUrl,
        }, user);
        setUser(nextUser);
        router.back();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t('validation.avatarSaveFailed');
        Alert.alert(t('validation.saveFailed'), message);
      } finally {
        setIsSaving(false);
      }

      return;
    }

    const validationError = validateProfileFieldValue(field.id, value);

    if (validationError) {
      Alert.alert(t('validation.cannotSave'), validationError);
      return;
    }

    setIsSaving(true);

    try {
      const nextUser = await updateUserProfile(
        user.id,
        toProfileUpdatePayload(field.id, value),
        user,
      );
      setUser(nextUser);
      router.back();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('validation.saveFailed');
      Alert.alert(t('validation.saveFailed'), message);
    } finally {
      setIsSaving(false);
    }
  }

  function handleConfirmBirthday() {
    const nextValue = `${birthdayDraft.year}-${pad(birthdayDraft.month)}-${pad(
      birthdayDraft.day,
    )}`;
    setValue(nextValue);
    setIsBirthdayPickerVisible(false);
  }

  function openCityPicker() {
    const nextRegion = findProvinceByCity(value);
    setCityDraftRegion(nextRegion.name);
    setCityDraftValue(value.trim());
    setIsCityPickerVisible(true);
  }

  function handleConfirmCity() {
    const nextValue = cityDraftValue.trim() || cityOptions[0] || '';
    setValue(nextValue);
    setIsCityPickerVisible(false);
  }

  if (!field || !field.editable) {
    return (
      <View style={[d.container, { paddingTop: insets.top, paddingHorizontal: Spacing.lg }]}>
        <NavHeader title={t('profile.editProfile')} />
        <View style={s.fieldBlock}>
          <Text style={d.fallbackTitle}>{t('profile.fieldNotEditable')}</Text>
          <Text style={d.fallbackText}>
            {field && 'unsupportedMessage' in field
              ? field.unsupportedMessage
              : t('profile.returnToSettings')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      testID={E2E_TEST_IDS.profileEditScreen}
      style={[d.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <NavHeader title={field.title} />
      <ScrollView
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
        {...keyboardDismissOnDragProps}
      >
        <View style={s.fieldBlock}>
          {field.editorType === 'avatar' ? (
            <View style={s.avatarEditor}>
              <Avatar
                size={112}
                name={user?.nickname ?? user?.accountId ?? 'C'}
                uri={avatarPreviewUri ?? undefined}
                bgColor={colors.surface}
              />
              <Pressable
                style={[s.avatarButton, d.avatarButton]}
                onPress={handlePickAvatar}
              >
                <Text style={d.avatarButtonText}>{t('profileFields.selectFromAlbum')}</Text>
              </Pressable>
            </View>
          ) : field.editorType === 'gender' ? (
            <View style={s.optionRow}>
              {genderOptions.map((option) => {
                const isActive = formatProfileFieldValue(field.id, value) === option;
                return (
                  <Pressable
                    key={option}
                    style={[
                      s.optionChip,
                      d.optionChip,
                      isActive ? d.optionChipActive : null,
                    ]}
                    onPress={() => setValue(option)}
                  >
                    <Text
                      style={[
                        d.optionChipText,
                        isActive ? d.optionChipTextActive : null,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : field.editorType === 'date' ? (
            <Pressable
              style={[s.dateField, d.dateField]}
              onPress={() => setIsBirthdayPickerVisible(true)}
            >
              <Text style={d.dateFieldText}>
                {formatProfileFieldValue(field.id, value)}
              </Text>
            </Pressable>
          ) : field.editorType === 'city' ? (
            <Pressable
              style={[s.dateField, d.dateField]}
              onPress={openCityPicker}
            >
              <Text style={d.dateFieldText}>
                {formatProfileFieldValue(field.id, value)}
              </Text>
            </Pressable>
          ) : (
            <TextInput
              testID={E2E_TEST_IDS.profileEditInput}
              value={value}
              onChangeText={setValue}
              placeholder={field.placeholder}
              placeholderTextColor={colors.textSecondary}
              style={[
                s.input,
                d.input,
                field.multiline ? { minHeight: 140 } : null,
              ]}
              multiline={field.multiline}
              keyboardType={field.keyboardType}
              autoCapitalize={field.autoCapitalize ?? 'none'}
            />
          )}
        </View>

        <View style={s.footer}>
          <Pressable
            testID={E2E_TEST_IDS.profileEditSave}
            style={[s.button, d.button, isSaving ? { opacity: 0.6 } : null]}
            onPress={handleSave}
            disabled={isSaving}
          >
            <Text style={d.buttonText}>{isSaving ? t('common.saving') : t('common.save')}</Text>
          </Pressable>
        </View>
      </ScrollView>
      <BottomSheetModal
        visible={isBirthdayPickerVisible}
        onClose={() => setIsBirthdayPickerVisible(false)}
        backdropStyle={d.modalBackdrop}
        sheetStyle={[
          s.modalCard,
          d.modalCard,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
      >
        <View style={s.modalHeader}>
          <Pressable onPress={() => setIsBirthdayPickerVisible(false)}>
            <Text style={d.actionText}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={d.modalTitle}>{t('profileFields.selectBirthday')}</Text>
          <Pressable onPress={handleConfirmBirthday}>
            <Text style={d.actionText}>{t('common.confirm')}</Text>
          </Pressable>
        </View>

        <View style={s.pickerColumns}>
          <View style={s.pickerColumn}>
            <ScrollView style={[s.pickerList, d.pickerList]}>
              {birthdayYears.map((year) => {
                const isActive = birthdayDraft.year === year;
                return (
                  <Pressable
                    key={year}
                    style={s.pickerItem}
                    onPress={() =>
                      setBirthdayDraft((current) => ({
                        ...current,
                        year,
                        day: Math.min(
                          current.day,
                          getDaysInMonth(year, current.month),
                        ),
                      }))
                    }
                  >
                    <Text
                      style={[
                        d.pickerItemText,
                        isActive ? d.pickerItemTextActive : null,
                      ]}
                    >
                      {t('profileFields.year', { year })}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={s.pickerColumn}>
            <ScrollView style={[s.pickerList, d.pickerList]}>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
                const isActive = birthdayDraft.month === month;
                return (
                  <Pressable
                    key={month}
                    style={s.pickerItem}
                    onPress={() =>
                      setBirthdayDraft((current) => ({
                        ...current,
                        month,
                        day: Math.min(
                          current.day,
                          getDaysInMonth(current.year, month),
                        ),
                      }))
                    }
                  >
                    <Text
                      style={[
                        d.pickerItemText,
                        isActive ? d.pickerItemTextActive : null,
                      ]}
                    >
                      {t('profileFields.month', { month })}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={s.pickerColumn}>
            <ScrollView style={[s.pickerList, d.pickerList]}>
              {birthdayDays.map((day) => {
                const isActive = birthdayDraft.day === day;
                return (
                  <Pressable
                    key={day}
                    style={s.pickerItem}
                    onPress={() =>
                      setBirthdayDraft((current) => ({
                        ...current,
                        day,
                      }))
                    }
                  >
                    <Text
                      style={[
                        d.pickerItemText,
                        isActive ? d.pickerItemTextActive : null,
                      ]}
                    >
                      {t('profileFields.day', { day })}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </BottomSheetModal>
      <BottomSheetModal
        visible={isCityPickerVisible}
        onClose={() => setIsCityPickerVisible(false)}
        backdropStyle={d.modalBackdrop}
        sheetStyle={[
          s.modalCard,
          d.modalCard,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
      >
        <View style={s.modalHeader}>
          <Pressable onPress={() => setIsCityPickerVisible(false)}>
            <Text style={d.actionText}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={d.modalTitle}>{t('profileFields.selectProvince')}</Text>
          <Pressable onPress={handleConfirmCity}>
            <Text style={d.actionText}>{t('common.confirm')}</Text>
          </Pressable>
        </View>

        <View style={s.pickerColumns}>
          <View style={s.pickerColumn}>
            <ScrollView style={[s.pickerList, d.pickerList]}>
              {CITY_PROVINCES.map((region) => {
                const isActive = cityDraftRegion === region.name;
                return (
                  <Pressable
                    key={region.name}
                    style={s.pickerItem}
                    onPress={() => {
                      setCityDraftRegion(region.name);
                      if (!region.cities.includes(cityDraftValue)) {
                        setCityDraftValue(region.cities[0] ?? '');
                      }
                    }}
                  >
                    <Text
                      style={[
                        d.pickerItemText,
                        isActive ? d.pickerItemTextActive : null,
                      ]}
                    >
                      {region.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={s.pickerColumn}>
            <ScrollView style={[s.pickerList, d.pickerList]}>
              {cityOptions.map((city) => {
                const isActive = cityDraftValue === city;
                return (
                  <Pressable
                    key={city}
                    style={s.pickerItem}
                    onPress={() => setCityDraftValue(city)}
                  >
                    <Text
                      style={[
                        d.pickerItemText,
                        isActive ? d.pickerItemTextActive : null,
                      ]}
                    >
                      {city}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </BottomSheetModal>
    </KeyboardAvoidingView>
  );
}
