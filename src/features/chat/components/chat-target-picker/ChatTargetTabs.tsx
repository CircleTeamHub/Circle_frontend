import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { ChatTargetTab } from './use-chat-target-sources';

export interface ChatTargetTabOption {
  id: ChatTargetTab;
  labelKey: string;
  fallback: string;
}

interface ChatTargetTabsProps {
  tabs: readonly ChatTargetTabOption[];
  active: ChatTargetTab;
  onChange: (tab: ChatTargetTab) => void;
}

const s = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  tab: {
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: { ...Typography.body },
  tabTextSelected: { fontWeight: '700' },
});

export function ChatTargetTabs({ tabs, active, onChange }: ChatTargetTabsProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={s.tabs} accessibilityRole="tablist">
      {tabs.map((item) => {
        const selected = item.id === active;
        return (
          <Pressable
            key={item.id}
            // 选中的是紫色实心胶囊:深色背景上只靠字重区分几乎看不出来。
            style={[s.tab, { backgroundColor: selected ? colors.primary : colors.inputBg }]}
            onPress={() => onChange(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text
              style={[
                s.tabText,
                { color: selected ? colors.white : colors.textSecondary },
                selected && s.tabTextSelected,
              ]}
            >
              {t(item.labelKey, { defaultValue: item.fallback })}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
