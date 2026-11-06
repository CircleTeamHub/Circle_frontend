import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Spacing, Typography, useTheme } from '@/theme';
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
    gap: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  tab: { minHeight: 32, justifyContent: 'center' },
  tabText: { ...Typography.body },
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
            style={s.tab}
            onPress={() => onChange(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text
              style={[
                s.tabText,
                { color: selected ? colors.text : colors.textSecondary },
                selected && { fontWeight: '700' },
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
