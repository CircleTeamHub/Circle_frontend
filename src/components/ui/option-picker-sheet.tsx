import { useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';

export interface PickerOption<T> {
  label: string;
  value: T;
}

interface OptionPickerSheetProps<T> {
  visible: boolean;
  title: string;
  options: ReadonlyArray<PickerOption<T>>;
  selectedValue: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
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
    height: 52,
  },
  optionLabel: { ...Typography.body },
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

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.text },
      optionLabel: { color: colors.text },
      optionLabelSelected: { color: colors.primary },
      separator: { backgroundColor: colors.surfaceBorder },
    }),
    [colors],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={[s.backdrop, d.backdrop]} onPress={onClose}>
        {/* 内层 Pressable 拦截点击，避免点 sheet 内部误触 backdrop 关闭 */}
        <Pressable
          style={[s.sheet, d.sheet, { paddingBottom: insets.bottom || Spacing.lg }]}
          onPress={() => {}}
        >
          <View style={[s.handle, d.handle]} />
          <View style={s.header}>
            <Text style={[s.title, d.title]}>{title}</Text>
            <Pressable
              style={s.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="关闭"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 360 }}
          >
            {options.map((option, index) => {
              const isSelected = option.value === selectedValue;
              return (
                <View key={`${String(option.value)}-${index}`}>
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
                        color={colors.primary}
                      />
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
