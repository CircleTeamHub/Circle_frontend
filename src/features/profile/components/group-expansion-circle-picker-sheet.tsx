import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { MyCircle } from '@/types';

const ROW_HEIGHT = 64;

const s = StyleSheet.create({
  sheet: {
    height: '90%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  closeButton: {
    padding: Spacing.xs,
  },
  search: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  input: {
    flex: 1,
    height: '100%',
    paddingVertical: 0,
    ...Typography.bodyRegular,
  },
  clearButton: {
    padding: Spacing.xs,
  },
  list: {
    flex: 1,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: Spacing.xs,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xxl,
  },
});

interface GroupExpansionCirclePickerSheetProps {
  visible: boolean;
  circles: readonly MyCircle[];
  selectedCircleId: string | null;
  onSelect: (circleId: string) => void;
  onClose: () => void;
}

export function GroupExpansionCirclePickerSheet({
  visible,
  circles,
  selectedCircleId,
  onSelect,
  onClose,
}: GroupExpansionCirclePickerSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredCircles = useMemo(
    () =>
      normalizedQuery
        ? circles.filter((circle) =>
            circle.name.toLocaleLowerCase().includes(normalizedQuery),
          )
        : circles,
    [circles, normalizedQuery],
  );

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={{ backgroundColor: colors.overlay }}
      sheetStyle={[
        s.sheet,
        {
          backgroundColor: colors.surface,
          paddingBottom: insets.bottom || Spacing.lg,
        },
      ]}
    >
      <View
        style={[s.handle, { backgroundColor: colors.surfaceBorder }]}
      />
      <View style={s.header}>
        <Text style={[Typography.h3, { color: colors.text }]}>
          {t('profile.groupExpansion.chooseCircle', {
            defaultValue: '选择要扩容的群',
          })}
        </Text>
        <Pressable
          style={s.closeButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close', { defaultValue: '关闭' })}
        >
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={[s.search, { backgroundColor: colors.background }]}>
        <Ionicons name="search" size={19} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('profile.groupExpansion.searchCirclePlaceholder', {
            defaultValue: '搜索群名称',
          })}
          placeholderTextColor={colors.textSecondary}
          style={[s.input, { color: colors.text }]}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="never"
        />
        {query.length > 0 ? (
          <Pressable
            style={s.clearButton}
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel={t('common.clear', { defaultValue: '清除' })}
          >
            <Ionicons
              name="close-circle"
              size={19}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={filteredCircles}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        style={s.list}
        renderItem={({ item, index }) => {
          const selected = item.id === selectedCircleId;
          return (
            <Pressable
              onPress={() => {
                onSelect(item.id);
                onClose();
              }}
              style={[
                s.row,
                index < filteredCircles.length - 1 && [
                  s.divider,
                  { borderBottomColor: colors.surfaceBorder },
                ],
                selected && { backgroundColor: colors.primaryLight },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <View
                style={[
                  s.rowIcon,
                  { backgroundColor: colors.primaryLight },
                ]}
              >
                <Ionicons
                  name="people-outline"
                  size={22}
                  color={colors.primary}
                />
              </View>
              <View style={s.rowText}>
                <Text
                  style={[Typography.body, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Text
                  style={[Typography.small, { color: colors.textSecondary }]}
                >
                  {t('profile.groupExpansion.members', {
                    defaultValue: '当前人数',
                  })}
                  ：{item.memberCount}
                </Text>
              </View>
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={selected ? colors.primary : colors.textSecondary}
              />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons
              name="search-outline"
              size={36}
              color={colors.textSecondary}
            />
            <Text style={[Typography.bodyRegular, { color: colors.textSecondary }]}>
              {t('profile.groupExpansion.noCircleMatches', {
                defaultValue: '没有匹配的群',
              })}
            </Text>
          </View>
        }
      />
    </BottomSheetModal>
  );
}
