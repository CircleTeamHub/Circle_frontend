import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { getApiErrorMessage } from '@/services/api/errors';
import { updateUserProfile } from '@/services/api/profile';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import {
  MODAL_INPUT_NATIVE_AUTO_FOCUS,
  useModalInputAutoFocus,
} from '@/hooks/use-modal-input-auto-focus';
import {
  formatProfileFieldValue,
  getProfileEditField,
  toProfileUpdatePayload,
  validateProfileFieldValue,
} from '@/features/profile/profile-edit-config';
import {
  formatBirthdayDraft,
  parseBirthdayValue,
  parseCityValue,
  type BirthdayDraft,
} from '@/features/profile/utils/profile-field-pickers';
import {
  BirthdayColumns,
  CityColumns,
  type CityDraft,
} from '@/features/profile/components/profile-picker-columns';

type EditableField = Extract<
  NonNullable<ReturnType<typeof getProfileEditField>>,
  { editable: true }
>;

interface ProfileFieldEditSheetProps {
  /** 要编辑的资料字段 id;null 表示面板关闭。头像不走这里(直接唤起相册)。 */
  fieldId: string | null;
  onClose: () => void;
}

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  headerSide: {
    minWidth: 64,
  },
  headerSideEnd: {
    minWidth: 64,
    alignItems: 'flex-end',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 52,
    textAlignVertical: 'top',
  },
  multilineInput: {
    minHeight: 120,
    maxHeight: 200,
  },
  optionList: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: Spacing.md,
  },
});

export const ProfileFieldEditSheet: React.FC<ProfileFieldEditSheetProps> = ({
  fieldId,
  onClose,
}) => {
  const field = fieldId ? getProfileEditField(fieldId) : undefined;
  const editable = field && field.editable && field.editorType !== 'avatar' ? field : null;

  return (
    <BottomSheetModal visible={editable !== null} onClose={onClose}>
      {/* 每次打开按当前资料重建草稿,上一次没保存的输入不会残留。 */}
      {editable ? (
        <ProfileFieldEditor key={editable.id} field={editable as EditableField} onClose={onClose} />
      ) : null}
    </BottomSheetModal>
  );
};

interface ProfileFieldEditorProps {
  field: EditableField;
  onClose: () => void;
}

function ProfileFieldEditor({ field, onClose }: ProfileFieldEditorProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const inputRef = useRef<TextInput>(null);

  const initialValue = useMemo(() => {
    const raw = user?.[field.valueKey];
    return typeof raw === 'string' ? raw : '';
    // 只在打开时取一次:保存中途资料被回写不应把正在编辑的草稿冲掉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [value, setValue] = useState(initialValue);
  const [birthday, setBirthday] = useState<BirthdayDraft>(() => parseBirthdayValue(initialValue));
  const [city, setCity] = useState<CityDraft>(() => parseCityValue(initialValue));
  const [saving, setSaving] = useState(false);

  const isTextField = field.editorType === undefined;
  useModalInputAutoFocus(inputRef, isTextField ? field.id : null);

  const genderOptions = [
    t('profileFields.male'),
    t('profileFields.female'),
    t('profileFields.genderNotSet'),
  ];

  async function save(nextValue: string) {
    if (!user || saving) return;
    const validationError = validateProfileFieldValue(field.id, nextValue);
    if (validationError) {
      Alert.alert(t('validation.cannotSave'), validationError);
      return;
    }
    setSaving(true);
    try {
      const nextUser = await updateUserProfile(
        user.id,
        toProfileUpdatePayload(field.id, nextValue),
        user,
      );
      setUser(nextUser);
      onClose();
    } catch (error) {
      Alert.alert(
        t('validation.saveFailed'),
        getApiErrorMessage(error, t('validation.saveFailed')),
      );
    } finally {
      setSaving(false);
    }
  }

  function handleConfirm() {
    if (field.editorType === 'date') {
      void save(formatBirthdayDraft(birthday));
      return;
    }
    if (field.editorType === 'city') {
      void save(city.city);
      return;
    }
    void save(value);
  }

  const actionText = { ...Typography.body, fontWeight: '600' as const };
  // 性别点一下就保存,不需要「完成」按钮。
  const showConfirm = field.editorType !== 'gender';

  return (
    <View
      style={[
        s.sheet,
        { backgroundColor: colors.background, paddingBottom: insets.bottom + Spacing.lg },
      ]}
    >
      <View style={[s.handle, { backgroundColor: colors.surfaceBorder }]} />
      <View style={s.header}>
        <Pressable style={s.headerSide} onPress={onClose} hitSlop={8} accessibilityRole="button">
          <Text style={[actionText, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
        </Pressable>
        <Text style={[Typography.h3, { color: colors.text }]} numberOfLines={1}>
          {field.title}
        </Text>
        <View style={s.headerSideEnd}>
          {showConfirm ? (
            saving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Pressable onPress={handleConfirm} hitSlop={8} accessibilityRole="button">
                <Text style={[actionText, { color: colors.primary }]}>{t('common.save')}</Text>
              </Pressable>
            )
          ) : null}
        </View>
      </View>

      {field.editorType === 'gender' ? (
        <View style={[s.optionList, { backgroundColor: colors.surface }]}>
          {genderOptions.map((option, index) => {
            const isActive = formatProfileFieldValue(field.id, value) === option;
            return (
              <Pressable
                key={option}
                style={[
                  s.optionRow,
                  index > 0
                    ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider }
                    : null,
                ]}
                disabled={saving}
                onPress={() => {
                  setValue(option);
                  void save(option);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[Typography.body, { color: colors.text }]}>{option}</Text>
                {isActive ? (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : field.editorType === 'date' ? (
        <BirthdayColumns draft={birthday} onChange={setBirthday} />
      ) : field.editorType === 'city' ? (
        <CityColumns draft={city} onChange={setCity} />
      ) : (
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={setValue}
          placeholder={field.placeholder}
          placeholderTextColor={colors.textSecondary}
          autoFocus={MODAL_INPUT_NATIVE_AUTO_FOCUS}
          style={[
            s.input,
            Typography.bodyRegular,
            {
              backgroundColor: colors.surface,
              borderColor: colors.surfaceBorder,
              color: colors.text,
            },
            field.multiline ? s.multilineInput : null,
          ]}
          multiline={field.multiline}
          keyboardType={field.keyboardType}
          autoCapitalize={field.autoCapitalize ?? 'none'}
          returnKeyType={field.multiline ? 'default' : 'done'}
          onSubmitEditing={field.multiline ? undefined : handleConfirm}
        />
      )}
    </View>
  );
}
