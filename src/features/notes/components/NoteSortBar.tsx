import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NOTE_SORT_MODES, type NoteSortMode } from '@/features/notes/utils/note-sort';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type Props = {
  mode: NoteSortMode;
  onChangeMode: (mode: NoteSortMode) => void;
  /** 手动排序时右侧出现「调整顺序」。 */
  onAdjust: () => void;
};

const LABEL_KEYS: Record<NoteSortMode, { key: string; fallback: string }> = {
  edited: { key: 'notes.sort.edited', fallback: '最近编辑' },
  added: { key: 'notes.sort.added', fallback: '最近添加' },
  manual: { key: 'notes.sort.manual', fallback: '手动排序' },
};

/** 搜索框下面的排序栏：最近编辑 / 最近添加 / 手动排序。头部收起后它留在顶上。 */
export function NoteSortBar({ mode, onChangeMode, onAdjust }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={s.row} accessibilityRole="tablist" accessibilityLabel={t('notes.sort.label', { defaultValue: '排序方式' })}>
      <Ionicons name="swap-vertical" size={14} color={colors.textSecondary} />
      {NOTE_SORT_MODES.map((item) => {
        const active = item === mode;
        return (
          <Pressable
            key={item}
            style={[s.option, active ? { backgroundColor: colors.primaryLight } : null]}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChangeMode(item)}
          >
            <Text style={[s.optionText, { color: active ? colors.link : colors.textSecondary }]}>
              {t(LABEL_KEYS[item].key, { defaultValue: LABEL_KEYS[item].fallback })}
            </Text>
          </Pressable>
        );
      })}
      {mode === 'manual' ? (
        <Pressable
          style={s.adjust}
          hitSlop={8}
          accessibilityRole="button"
          onPress={onAdjust}
        >
          <Ionicons name="reorder-three-outline" size={16} color={colors.link} />
          <Text style={[s.optionText, { color: colors.link }]}>
            {t('notes.sort.adjust', { defaultValue: '调整顺序' })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  option: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    justifyContent: 'center',
  },
  optionText: { ...Typography.small, fontWeight: '500' },
  adjust: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 28,
  },
});
