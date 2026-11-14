import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

/** 与服务端 CreateConversationGroupDto 的 MaxLength 一致。 */
export const GROUP_NAME_MAX_LENGTH = 32;

interface GroupEditFormProps {
  name: string;
  onChangeName: (name: string) => void;
  pinnedToTabs: boolean;
  onChangePinned: (pinned: boolean) => void;
  autoFocus: boolean;
  editable: boolean;
}

const s = StyleSheet.create({
  section: { gap: Spacing.sm },
  label: { ...Typography.caption, fontWeight: '600' },
  input: {
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    ...Typography.bodyRegular,
  },
  counter: { ...Typography.small, alignSelf: 'flex-end' },
  switchRow: {
    minHeight: 56,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  switchText: { flex: 1, gap: 2 },
  switchTitle: { ...Typography.body },
  switchHint: { ...Typography.small },
});

export const GroupEditForm = memo(function GroupEditForm({
  name,
  onChangeName,
  pinnedToTabs,
  onChangePinned,
  autoFocus,
  editable,
}: GroupEditFormProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({
      label: { color: colors.textSecondary },
      input: {
        color: colors.text,
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.surface,
      },
      card: { backgroundColor: colors.surface },
      title: { color: colors.text },
      hint: { color: colors.textSecondary },
    }),
    [colors],
  );

  return (
    <>
      <View style={s.section}>
        <Text style={[s.label, d.label]}>
          {t('messages.groups.nameLabel', { defaultValue: '分组名称' })}
        </Text>
        <TextInput
          style={[s.input, d.input]}
          value={name}
          onChangeText={onChangeName}
          placeholder={t('messages.groups.namePlaceholder', { defaultValue: '例如：家人 / 工作' })}
          placeholderTextColor={colors.textSecondary}
          maxLength={GROUP_NAME_MAX_LENGTH}
          autoCorrect={false}
          autoFocus={autoFocus}
          editable={editable}
          returnKeyType="done"
        />
        <Text style={[s.counter, d.hint]}>
          {name.length}/{GROUP_NAME_MAX_LENGTH}
        </Text>
      </View>
      <View style={[s.switchRow, d.card]}>
        <View style={s.switchText}>
          <Text style={[s.switchTitle, d.title]}>
            {t('messages.groups.showInTabs', { defaultValue: '在消息页显示' })}
          </Text>
          <Text style={[s.switchHint, d.hint]}>
            {t('messages.groups.showInTabsHint', {
              defaultValue: '关闭后分组保留，只是不出现在消息页顶部',
            })}
          </Text>
        </View>
        <ThemedSwitch
          value={pinnedToTabs}
          onValueChange={onChangePinned}
          disabled={!editable}
          accessibilityLabel={t('messages.groups.showInTabs', { defaultValue: '在消息页显示' })}
        />
      </View>
    </>
  );
});
