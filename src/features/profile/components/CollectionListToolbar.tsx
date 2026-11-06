import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CollectionType } from '@/services/api/collections';
import { Spacing, useTheme } from '@/theme';

export type CollectionTab = 'ALL' | Exclude<CollectionType, 'NOTE'>;
const TABS: CollectionTab[] = ['ALL', 'CHAT', 'VIDEO', 'VOICE', 'MESSAGE'];

export function CollectionListToolbar({ query, onQueryChange, activeType, onTypeChange, disabled = false }: {
  query: string; onQueryChange: (query: string) => void;
  activeType: CollectionTab; onTypeChange: (type: CollectionTab) => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return <View style={s.toolbar}>
    <View style={[s.search, { backgroundColor: colors.surface }]}>
      <Ionicons name="search" size={18} color={colors.textSecondary} />
      <TextInput style={[s.input, { color: colors.text }]} value={query} onChangeText={onQueryChange} editable={!disabled}
        accessibilityLabel={t('common.search', { defaultValue: '搜索' })} placeholder={t('common.search', { defaultValue: '搜索' })}
        placeholderTextColor={colors.textSecondary} clearButtonMode="while-editing" returnKeyType="search" />
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
      {TABS.map(type => <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: type === activeType, disabled }}
        disabled={disabled} onPress={() => onTypeChange(type)} style={[s.tab, { borderBottomColor: activeType === type ? colors.primary : 'transparent' }]}>
        <Text style={{ fontSize: 14, color: activeType === type ? colors.primary : colors.textSecondary }}>{t('profile.collections.tabs.' + type.toLowerCase())}</Text>
      </Pressable>)}
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  toolbar: { gap: 8, paddingTop: 8, paddingBottom: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, paddingHorizontal: 12, minHeight: 44 },
  input: { flex: 1, fontSize: 16, minHeight: 44, paddingVertical: 8 },
  tabs: { gap: Spacing.lg },
  tab: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 4, borderBottomWidth: 2 },
});
