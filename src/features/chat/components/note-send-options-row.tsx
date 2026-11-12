import { Ionicons } from '@expo/vector-icons';
import type { Dispatch, SetStateAction } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  isAllNoteSendOptions,
  withAllNoteSendOptions,
  type NoteSendOptions,
} from '@/features/chat/utils/note-batch-send';
import {
  iconForeground,
  Radius,
  Spacing,
  Typography,
  useTheme,
  withAlpha,
  type ResolvedMode,
  type ThemeColors,
} from '@/theme';

// 底栏常驻的「发什么」开关(横排 icon+短标签)。「三连」是三项的派生开关,单独渲染。
// accent 取自色板 token:每项一个色相,选中时同色淡底+同色描边+同色图标文字,
// 未选中保持中性灰 —— 让"选了什么"一眼可辨,而不是四个一样的灰框。
const NOTE_OPTION_CHIPS = [
  {
    key: 'card',
    icon: 'document-text-outline',
    accent: 'primary',
    labelKey: 'share.noteBatch.optionCard',
    defaultLabel: '笔记',
  },
  {
    key: 'showcase',
    icon: 'sparkles-outline',
    accent: 'orange',
    labelKey: 'share.noteBatch.optionShowcase',
    defaultLabel: '展示',
  },
  {
    key: 'location',
    icon: 'location-outline',
    accent: 'success',
    labelKey: 'share.noteBatch.optionLocation',
    defaultLabel: '地址',
  },
] as const;

/** 「三连」是三项的派生开关，用品牌紫与单项色相区隔。 */
const NOTE_OPTION_ALL_ACCENT = 'brandPurple' as const;

type NoteOptionAccent =
  | (typeof NOTE_OPTION_CHIPS)[number]['accent']
  | typeof NOTE_OPTION_ALL_ACCENT;

/**
 * 分区色在当前主题下的**唯一**可读色值：底/边/图标/文字/对号全用它。
 *
 * 主色不走通用提亮公式 —— 色板里已经钉了它的暗色版本 iconAccent（与
 * tabBarActive 同值）；再算一次会得到 #A1A3F7，同一屏里就出现两种紫。
 */
function noteOptionTone(
  accent: NoteOptionAccent,
  colors: ThemeColors,
  mode: ResolvedMode,
): string {
  return accent === 'primary'
    ? colors.iconAccent
    : iconForeground(colors[accent], mode);
}

interface NoteOptionChipProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** 该项已按当前主题解析好的分区色：选中态的底/边/字/图标/对号共用它 */
  tone: string;
  checked: boolean;
  onToggle: () => void;
}

/** 底栏「发什么」单个开关：图标 + 标签 + 对号。三个分区与「三连」共用。 */
function NoteOptionChip({
  icon,
  label,
  tone,
  checked,
  onToggle,
}: NoteOptionChipProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      style={[
        s.optionChip,
        {
          borderColor: checked ? tone : colors.surfaceBorder,
          backgroundColor: checked ? withAlpha(tone, 0.12) : colors.background,
        },
      ]}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <Ionicons
        name={icon}
        size={20}
        color={checked ? tone : colors.textSecondary}
      />
      <Text
        style={[
          s.optionChipLabel,
          checked ? s.optionChipLabelOn : null,
          { color: checked ? tone : colors.textSecondary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {/* 对号常驻占位：选中实心、未选空心，两态等高，切换时行高不跳。
          只靠配色区分选中对色觉障碍用户不友好，这里补一个形状信号。 */}
      <Ionicons
        name={checked ? 'checkmark-circle' : 'ellipse-outline'}
        size={15}
        color={checked ? tone : colors.surfaceBorder}
      />
    </Pressable>
  );
}

const s = StyleSheet.create({
  optionChipsRow: {
    flexDirection: 'row',
    gap: Spacing.sm - 2,
  },
  optionChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: 2,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
  },
  optionChipLabel: {
    ...Typography.tinyRegular,
    fontWeight: '500',
  },
  optionChipLabelOn: {
    fontWeight: '700',
  },
});

interface NoteSendOptionsRowProps {
  value: NoteSendOptions;
  onChange: Dispatch<SetStateAction<NoteSendOptions>>;
}

/** 发笔记时「发什么」的四个开关:笔记 / 展示 / 地址 / 三连。 */
export function NoteSendOptionsRow({ value, onChange }: NoteSendOptionsRowProps) {
  const { colors, resolvedMode } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={s.optionChipsRow}>
      {NOTE_OPTION_CHIPS.map((chip) => (
        <NoteOptionChip
          key={chip.key}
          icon={chip.icon}
          label={t(chip.labelKey, { defaultValue: chip.defaultLabel })}
          tone={noteOptionTone(chip.accent, colors, resolvedMode)}
          checked={value[chip.key]}
          onToggle={() => onChange((prev) => ({ ...prev, [chip.key]: !prev[chip.key] }))}
        />
      ))}
      <NoteOptionChip
        icon="checkmark-done-outline"
        label={t('share.noteBatch.optionAll', { defaultValue: '三连' })}
        tone={noteOptionTone(NOTE_OPTION_ALL_ACCENT, colors, resolvedMode)}
        checked={isAllNoteSendOptions(value)}
        onToggle={() => onChange((prev) => withAllNoteSendOptions(prev, !isAllNoteSendOptions(prev)))}
      />
    </View>
  );
}
