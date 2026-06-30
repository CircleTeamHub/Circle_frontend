import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export interface CreateTempChatPayload {
  title?: string;
  ttlMinutes: number;
  maxMembers: number;
}

interface CreateTempChatModalProps {
  visible: boolean;
  creating: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateTempChatPayload) => void;
}

// 有效期预设：范围与后端 DTO（30 ~ 10080 分钟）对齐，默认 3 天（4320）。
const DURATION_OPTIONS: { minutes: number; labelKey: string }[] = [
  { minutes: 60, labelKey: 'tempChats.duration.1h' },
  { minutes: 360, labelKey: 'tempChats.duration.6h' },
  { minutes: 1440, labelKey: 'tempChats.duration.1d' },
  { minutes: 4320, labelKey: 'tempChats.duration.3d' },
  { minutes: 10080, labelKey: 'tempChats.duration.7d' },
];
const DEFAULT_TTL_MINUTES = 4320;

// 人数预设：范围与后端 DTO（2 ~ 50）对齐，默认 50。
const MEMBER_OPTIONS = [10, 20, 50];
const DEFAULT_MAX_MEMBERS = 50;

const s = StyleSheet.create({
  card: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.lg,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
  },
  content: {
    gap: Spacing.lg,
  },
  field: {
    gap: Spacing.sm,
  },
  titleInput: {
    height: 44,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButton: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function CreateTempChatModal({
  visible,
  creating,
  onClose,
  onSubmit,
}: CreateTempChatModalProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [title, setTitle] = useState('');
  const [ttlMinutes, setTtlMinutes] = useState(DEFAULT_TTL_MINUTES);
  const [maxMembers, setMaxMembers] = useState(DEFAULT_MAX_MEMBERS);

  // 每次打开都回到默认值，避免上次的输入残留。
  useEffect(() => {
    if (visible) {
      setTitle('');
      setTtlMinutes(DEFAULT_TTL_MINUTES);
      setMaxMembers(DEFAULT_MAX_MEMBERS);
    }
  }, [visible]);

  const d = useMemo(
    () => ({
      backdrop: {
        backgroundColor: 'rgba(0,0,0,0.45)',
      },
      card: {
        backgroundColor: colors.background,
        paddingBottom: insets.bottom + Spacing.lg,
      },
      handle: {
        backgroundColor: colors.surfaceBorder,
      },
      heading: {
        color: colors.text,
        ...Typography.h3,
        textAlign: 'center' as const,
      },
      label: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      titleInput: {
        backgroundColor: colors.surface,
        color: colors.text,
        ...Typography.bodyRegular,
      },
      chipText: {
        color: colors.text,
        ...Typography.small,
        fontWeight: '600' as const,
      },
      chipTextSelected: {
        color: colors.white,
        ...Typography.small,
        fontWeight: '600' as const,
      },
      submitText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors, insets.bottom],
  );

  const handleSubmit = () => {
    if (creating) return;
    const trimmed = title.trim();
    onSubmit({
      title: trimmed ? trimmed : undefined,
      ttlMinutes,
      maxMembers,
    });
  };

  const renderChip = (
    label: string,
    selected: boolean,
    onPress: () => void,
    key: string | number,
  ) => (
    <Pressable
      key={key}
      style={[
        s.chip,
        {
          backgroundColor: selected ? colors.primary : colors.surface,
        },
      ]}
      onPress={onPress}
    >
      <Text style={selected ? d.chipTextSelected : d.chipText}>{label}</Text>
    </Pressable>
  );

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[s.card, d.card]}
    >
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        <View style={[s.handle, d.handle]} />
        <Text style={d.heading}>{t('tempChats.createTitle')}</Text>

        <View style={s.field}>
          <Text style={d.label}>{t('tempChats.titleLabel')}</Text>
          <TextInput
            style={[s.titleInput, d.titleInput]}
            placeholder={t('tempChats.titlePlaceholder')}
            placeholderTextColor={colors.textSecondary}
            value={title}
            onChangeText={setTitle}
            maxLength={30}
          />
        </View>

        <View style={s.field}>
          <Text style={d.label}>{t('tempChats.durationLabel')}</Text>
          <View style={s.chipRow}>
            {DURATION_OPTIONS.map((option) =>
              renderChip(
                t(option.labelKey),
                ttlMinutes === option.minutes,
                () => setTtlMinutes(option.minutes),
                option.minutes,
              ),
            )}
          </View>
        </View>

        <View style={s.field}>
          <Text style={d.label}>{t('tempChats.membersLabel')}</Text>
          <View style={s.chipRow}>
            {MEMBER_OPTIONS.map((count) =>
              renderChip(
                t('tempChats.membersUnit', { count }),
                maxMembers === count,
                () => setMaxMembers(count),
                count,
              ),
            )}
          </View>
        </View>

        <Pressable
          style={[
            s.submitButton,
            {
              backgroundColor: colors.primary,
              opacity: creating ? 0.6 : 1,
            },
          ]}
          onPress={handleSubmit}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={d.submitText}>{t('tempChats.submit')}</Text>
          )}
        </Pressable>
      </ScrollView>
    </BottomSheetModal>
  );
}
