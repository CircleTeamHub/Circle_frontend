import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export interface InboxTab {
  id: string;
  label: string;
}

interface InboxTabsHeaderProps {
  tabs: InboxTab[];
  activeId: string;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchPlaceholder: string;
}

const s = StyleSheet.create({
  // 白色面板从标题栏下方起、上缘圆角，页签和搜索框都住在里面。
  panel: {
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  tabRow: {
    flexDirection: 'row',
  },
  // 两个页签各占一半、文字居中：这是页面的主分栏，不是一排筛选小药丸。
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.md,
    gap: 6,
  },
  // 选中条常驻占位（未选中时透明），否则切页签时文字会上下跳。
  indicator: {
    height: 3,
    width: 28,
    borderRadius: 2,
    marginBottom: Spacing.sm,
  },
  searchBox: {
    height: 44,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.xs,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    ...Typography.bodyRegular,
    paddingVertical: 0,
  },
});

export const InboxTabsHeader: React.FC<InboxTabsHeaderProps> = ({
  tabs,
  activeId,
  onSelect,
  query,
  onQueryChange,
  searchPlaceholder,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      panel: {
        backgroundColor: colors.surface,
      },
      tabLabel: {
        ...Typography.h3,
        color: colors.textSecondary,
        fontWeight: '500' as const,
      },
      // 选中态走品牌紫：字色 + 下方指示条，一眼看得出点中的是哪一栏。
      tabLabelActive: {
        color: colors.primary,
        fontWeight: '700' as const,
      },
      indicator: {
        backgroundColor: colors.primary,
      },
      indicatorIdle: {
        backgroundColor: 'transparent',
      },
      searchBox: {
        backgroundColor: colors.surfaceMuted,
      },
      searchInput: {
        color: colors.text,
      },
    }),
    [colors],
  );

  return (
    <View style={[s.panel, d.panel]}>
      <View style={s.tabRow} accessibilityRole="tablist">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <Pressable
              key={tab.id}
              style={s.tab}
              onPress={() => onSelect(tab.id)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[d.tabLabel, active && d.tabLabelActive]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
              <View
                style={[s.indicator, active ? d.indicator : d.indicatorIdle]}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={[s.searchBox, d.searchBox]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, d.searchInput]}
          value={query}
          onChangeText={onQueryChange}
          placeholder={searchPlaceholder}
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={searchPlaceholder}
        />
        {query ? (
          <Pressable
            onPress={() => onQueryChange('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.clear')}
          >
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};
