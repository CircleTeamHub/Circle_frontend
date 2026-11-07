import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GROUP_NAME_MAX_LENGTH } from '@/features/notes/constants';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface CollectCreateGroupRowProps {
  disabled?: boolean;
  /** 建好后由调用方选中这个新分组;失败时返回 false,保留输入让用户重试。 */
  onCreate: (name: string) => Promise<boolean>;
}

const s = StyleSheet.create({
  row: {
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  icon: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  input: { ...Typography.body, flex: 1, minHeight: 40, paddingVertical: Spacing.xs },
  confirm: { minHeight: 36, paddingHorizontal: Spacing.md, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});

/** 收藏选分组那一步的新建分组输入行:弹窗右上角「新建」点开后出现在列表顶部,建好直接选中。 */
export function CollectCreateGroupRow({ disabled = false, onCreate }: CollectCreateGroupRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const trimmed = name.trim();

  const handleCreate = async () => {
    if (!trimmed || creating || disabled) return;
    setCreating(true);
    const created = await onCreate(trimmed);
    setCreating(false);
    if (created) setName('');
  };

  const rowStyle = [s.row, { borderColor: colors.primary, backgroundColor: colors.background }];
  const icon = (
    <View style={[s.icon, { backgroundColor: colors.primaryLight }]}>
      <Ionicons name="add" size={18} color={colors.primary} />
    </View>
  );

  return (
    <View style={rowStyle}>
      {icon}
      <TextInput
        style={[s.input, { color: colors.text }]}
        value={name}
        onChangeText={setName}
        placeholder={t('notes.collect.createGroupPlaceholder', { defaultValue: '输入分组名称' })}
        placeholderTextColor={colors.textSecondary}
        maxLength={GROUP_NAME_MAX_LENGTH}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void handleCreate()}
        editable={!creating && !disabled}
        accessibilityLabel={t('notes.collect.createGroup', { defaultValue: '新建分组' })}
      />
      <Pressable
        style={[s.confirm, { backgroundColor: colors.primary }, !trimmed && { opacity: 0.55 }]}
        onPress={() => void handleCreate()}
        disabled={!trimmed || creating || disabled}
        accessibilityRole="button"
      >
        {creating ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={{ ...Typography.small, color: colors.white }}>
            {t('notes.collect.createGroupConfirm', { defaultValue: '创建' })}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
