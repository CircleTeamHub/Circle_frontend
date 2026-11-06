import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const s = StyleSheet.create({
  sectionWrap: { gap: Spacing.sm },
  sectionLabel: { paddingHorizontal: Spacing.md, gap: Spacing.xs / 2 },
  sectionTitle: { ...Typography.caption },
  sectionHint: { ...Typography.small },
  section: { borderRadius: Radius.xl, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 56,
  },
  rowText: { flex: 1, gap: Spacing.xs / 2 },
  label: { ...Typography.body },
  meta: { ...Typography.small },
  icon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAction: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  actionText: { ...Typography.small },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  emptyRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  empty: { ...Typography.bodyRegular },
});

function usePartColors() {
  const { colors } = useTheme();
  return useMemo(
    () => ({
      colors,
      section: { backgroundColor: colors.surface },
      title: { color: colors.textSecondary },
      text: { color: colors.text },
      secondary: { color: colors.textSecondary },
      destructive: { color: colors.danger },
      primary: { color: colors.primary },
      accent: { color: colors.iconAccent },
      iconBg: { backgroundColor: colors.primaryLight },
      iconBgDanger: { backgroundColor: colors.surfaceMuted },
      action: { borderColor: colors.divider },
    }),
    [colors],
  );
}

/** 分组:组外小标题 + 圆角卡片。 */
export const ManageSection: React.FC<{ title?: string; hint?: string; children: ReactNode }> = ({
  title,
  hint,
  children,
}) => {
  const d = usePartColors();
  return (
    <View style={s.sectionWrap}>
      {title ? (
        <View style={s.sectionLabel}>
          <Text style={[s.sectionTitle, d.title]}>{title}</Text>
          {hint ? <Text style={[s.sectionHint, d.secondary]}>{hint}</Text> : null}
        </View>
      ) : null}
      <View style={[s.section, d.section]}>{children}</View>
    </View>
  );
};

/** 入口行:左侧图标、标题与说明、右侧箭头;destructive 用于转让群主这类不可逆入口。 */
export const ManageLinkRow: React.FC<{
  icon: IconName;
  label: string;
  subtitle?: string;
  destructive?: boolean;
  onPress: () => void;
  testID: string;
}> = ({ icon, label, subtitle, destructive, onPress, testID }) => {
  const d = usePartColors();
  const tint = destructive ? d.colors.danger : d.colors.primary;
  return (
    <Pressable style={s.row} onPress={onPress} accessibilityRole="button" testID={testID}>
      <View style={[s.icon, destructive ? d.iconBgDanger : d.iconBg]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={s.rowText}>
        <Text style={[s.label, destructive ? d.destructive : d.text]}>{label}</Text>
        {subtitle ? (
          <Text style={[s.meta, d.secondary]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={d.colors.textSecondary} />
    </Pressable>
  );
};

export const ManageSwitchRow: React.FC<{
  label: string;
  hint?: string;
  value: boolean;
  onToggle: (next: boolean) => void;
  disabled: boolean;
}> = ({ label, hint, value, onToggle, disabled }) => {
  const d = usePartColors();
  return (
    <View style={s.row}>
      <View style={s.rowText}>
        <Text style={[s.label, d.text]}>{label}</Text>
        {hint ? <Text style={[s.meta, d.secondary]}>{hint}</Text> : null}
      </View>
      <ThemedSwitch
        value={value}
        onValueChange={disabled ? undefined : onToggle}
        disabled={disabled}
      />
    </View>
  );
};

/** 成员行:头像、名字、说明,右侧一个胶囊按钮(移除管理员 / 解除禁言)。 */
export const ManageMemberRow: React.FC<{
  name: string;
  avatarUrl: string | null;
  meta?: string;
  actionLabel: string;
  pending: boolean;
  onPress: () => void;
}> = ({ name, avatarUrl, meta, actionLabel, pending, onPress }) => {
  const d = usePartColors();
  return (
    <View style={s.row}>
      <Avatar size={40} shape="square" name={name} uri={avatarUrl ?? undefined} />
      <View style={s.rowText}>
        <Text style={[s.label, d.text]} numberOfLines={1}>
          {name}
        </Text>
        {meta ? (
          <Text style={[s.meta, d.secondary]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Pressable
        style={[s.rowAction, d.action]}
        onPress={onPress}
        disabled={pending}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
      >
        {pending ? (
          <ActivityIndicator size="small" color={d.colors.primary} />
        ) : (
          <Text style={[s.actionText, d.primary]}>{actionLabel}</Text>
        )}
      </Pressable>
    </View>
  );
};

export const ManageAddRow: React.FC<{ label: string; onPress: () => void; testID: string }> = ({
  label,
  onPress,
  testID,
}) => {
  const d = usePartColors();
  return (
    <Pressable style={s.addRow} onPress={onPress} accessibilityRole="button" testID={testID}>
      <Ionicons name="add-circle-outline" size={22} color={d.colors.iconAccent} />
      <Text style={[s.label, d.accent]}>{label}</Text>
    </Pressable>
  );
};

export const ManageEmptyRow: React.FC<{ text: string }> = ({ text }) => {
  const d = usePartColors();
  return (
    <View style={s.emptyRow}>
      <Text style={[s.empty, d.secondary]}>{text}</Text>
    </View>
  );
};
