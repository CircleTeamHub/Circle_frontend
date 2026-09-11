import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { useTheme, Spacing, Typography, Radius } from '@/theme';

export interface PickerOption<T> {
  label: string;
  value: T;
}

interface OptionPickerSheetProps<T> {
  visible: boolean;
  title: string;
  options: readonly PickerOption<T>[];
  selectedValue: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  title: { ...Typography.h3 },
  closeBtn: { padding: Spacing.xs },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minHeight: 52,
    gap: Spacing.md,
  },
  optionLabel: {
    ...Typography.body,
    flexShrink: 1,
  },
});

export function OptionPickerSheet<T extends string | number | null>({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
}: OptionPickerSheetProps<T>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  // 列表比可视区长时(阅后即焚是 18 档),已选项可能整个在折叠线以下 —— 打开面板
  // 只看到「关闭」在最上面,看起来像一项都没选。每次打开时把它滚进视野。
  // 用行自己的 onLayout 而不是 index * 行高:标签会折行,行高不是常数。
  const hasRevealedSelection = useRef(false);
  useEffect(() => {
    if (!visible) hasRevealedSelection.current = false;
  }, [visible]);

  const revealIfSelected = useCallback(
    (isSelected: boolean) => (event: LayoutChangeEvent) => {
      if (!isSelected || hasRevealedSelection.current) return;
      hasRevealedSelection.current = true;
      // 上面留一行的余量,让人看得出还有更靠前的选项。
      const y = Math.max(0, event.nativeEvent.layout.y - 52);
      scrollRef.current?.scrollTo({ y, animated: false });
    },
    [],
  );

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.text },
      optionLabel: { color: colors.text },
      optionLabelSelected: { color: colors.iconAccent },
      separator: { backgroundColor: colors.surfaceBorder },
    }),
    [colors],
  );

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[s.sheet, d.sheet, { paddingBottom: insets.bottom || Spacing.lg }]}
    >
      <View style={[s.handle, d.handle]} />
      <View style={s.header}>
        <Text style={[s.title, d.title]}>{title}</Text>
        <Pressable
          style={s.closeBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>
      <ScrollView
        ref={scrollRef}
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: 360 }}
      >
        {options.map((option, index) => {
          const isSelected = option.value === selectedValue;
          return (
            <View
              key={`${String(option.value)}-${index}`}
              onLayout={revealIfSelected(isSelected)}
            >
              <Pressable
                style={s.optionRow}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={option.label}
              >
                <Text
                  numberOfLines={2}
                  style={[
                    s.optionLabel,
                    isSelected ? d.optionLabelSelected : d.optionLabel,
                  ]}
                >
                  {option.label}
                </Text>
                {isSelected ? (
                  <Ionicons
                    name="checkmark"
                    size={20}
                    color={colors.iconAccent}
                  />
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </BottomSheetModal>
  );
}
