import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { MemberName } from '@/components/ui/member-name';
import { Divider } from '@/components/ui/divider';
import { Spacing, useTheme } from '@/theme';
import type { PostSignupItem } from '@/types';

interface RecognitionPickerModalProps {
  signups: PostSignupItem[];
  /** 这次还能认可几人：每个活动共 3 人，已认可的也计入。 */
  remainingSlots: number;
  submitting: boolean;
  onClose: () => void;
  /** 提交选中的报名者；调用方在成功后卸载本弹层，失败时留在原处可重试。 */
  onSubmit: (recipientIds: string[]) => void;
}

/**
 * 合作认可：活动结束后从报名者里勾选最多 3 人提交。
 * 和报名列表（对话入口）分开、单独一个全屏弹层，避免同一个列表里「点一下」
 * 有时是进聊天、有时是勾选。弹层按需挂载，关掉即丢弃搜索词和勾选。
 */
export function RecognitionPickerModal({
  signups,
  remainingSlots,
  submitting,
  onClose,
  onSubmit,
}: RecognitionPickerModalProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const visibleSignups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return signups;
    return signups.filter(
      (item) =>
        item.nickname.toLowerCase().includes(needle) ||
        item.accountId.toLowerCase().includes(needle),
    );
  }, [query, signups]);

  const toggle = (item: PostSignupItem) => {
    if (submitting || item.recognized) return;
    if (selected.has(item.userId)) {
      setSelected((current) => {
        const next = new Set(current);
        next.delete(item.userId);
        return next;
      });
      return;
    }
    if (selected.size >= remainingSlots) {
      Alert.alert(
        t('notifications.signupMgmt.recognitionLimitTitle', { defaultValue: '最多选择 3 人' }),
        t('notifications.signupMgmt.recognitionLimitMessage', {
          defaultValue: '每个活动最多给 3 位报名者合作认可。',
        }),
      );
      return;
    }
    setSelected((current) => new Set(current).add(item.userId));
  };

  const canSubmit = selected.size > 0 && !submitting;

  return (
    <Modal animationType="slide" onRequestClose={() => { if (!submitting) onClose(); }}>
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[s.header, { borderBottomColor: colors.surfaceBorder }]}>
          <Pressable accessibilityRole="button" disabled={submitting} onPress={onClose} hitSlop={8}>
            <Text style={[s.headerAction, { color: colors.text }]}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={[s.title, { color: colors.text }]} numberOfLines={1}>
            {t('notifications.signupMgmt.recognitionSubmit', { defaultValue: '提交认可' })}
          </Text>
          <Pressable
            testID="collaboration-recognition-submit"
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={() => onSubmit(Array.from(selected))}
            hitSlop={8}
          >
            {submitting ? (
              <ActivityIndicator color={colors.iconAccent} />
            ) : (
              <Text
                style={[
                  s.headerAction,
                  s.headerActionStrong,
                  { color: canSubmit ? colors.iconAccent : colors.textSecondary },
                ]}
              >
                {t('common.submit')}
              </Text>
            )}
          </Pressable>
        </View>

        <View style={s.toolbar}>
          <View style={[s.searchBox, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}>
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('notifications.signupMgmt.searchPlaceholder', { defaultValue: '搜索报名者' })}
              placeholderTextColor={colors.textSecondary}
              style={[s.searchInput, { color: colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Text style={[s.summary, { color: colors.textSecondary }]}>
            {t('notifications.signupMgmt.recognitionSelectionSummary', {
              count: selected.size,
              max: remainingSlots,
              defaultValue: `已选 ${selected.size}/${remainingSlots}`,
            })}
          </Text>
        </View>

        <FlatList
          data={visibleSignups}
          keyExtractor={(item) => item.userId}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={Divider}
          contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: insets.bottom + Spacing.lg }}
          renderItem={({ item }) => {
            const checked = item.recognized || selected.has(item.userId);
            return (
              <Pressable
                style={s.row}
                onPress={() => toggle(item)}
                disabled={item.recognized || submitting}
                accessibilityRole="checkbox"
                accessibilityLabel={item.nickname}
                accessibilityState={{ checked, disabled: item.recognized }}
              >
                <View
                  style={[
                    s.selectDot,
                    {
                      backgroundColor: checked ? colors.primary : colors.surface,
                      borderColor: checked ? colors.primary : colors.surfaceBorder,
                      opacity: item.recognized ? 0.6 : 1,
                    },
                  ]}
                >
                  {checked ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}
                </View>
                <Avatar size={40} name={item.nickname} uri={item.avatarUrl ?? undefined} />
                <View style={s.nameRow}>
                  <MemberName
                    name={item.nickname}
                    userId={item.userId}
                    numberOfLines={1}
                    style={{ fontSize: 15, fontWeight: '600', color: colors.text, flexShrink: 1 }}
                  />
                  {item.recognized ? (
                    <Text style={[s.recognizedTag, { color: colors.iconAccent }]}>
                      {t('notifications.signupMgmt.recognizedTag', { defaultValue: '已认可' })}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={[s.empty, { color: colors.textSecondary }]}>
              {t('notifications.signupMgmt.noSearchResults', { defaultValue: '没有匹配的报名者' })}
            </Text>
          }
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', marginHorizontal: Spacing.sm },
  headerAction: { fontSize: 16 },
  headerActionStrong: { fontWeight: '600' },
  toolbar: { gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  searchBox: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  summary: { fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  selectDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  recognizedTag: { fontSize: 11, fontWeight: '700' },
  empty: { textAlign: 'center', paddingTop: 60 },
});
