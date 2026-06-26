import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { MyCirclesPanel } from '@/features/discover/components/my-circles-panel';

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  joinRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  joinInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 0,
    textAlignVertical: 'center' as const,
    ...Typography.bodyRegular,
  },
  joinBtn: {
    height: 40,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  joinBtnText: { ...Typography.caption, fontWeight: '600' as const },
});

// Standalone "my circles" management page. Reuses the same MyCirclesPanel the
// Discover tab renders (joined / created / managed / applied tabs + create), and
// adds a "join by id" box so a circle ID shared by a friend lands you on the
// circle's detail (where the join button lives).
export default function MyCirclesScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [joinId, setJoinId] = useState('');

  const handleOpenById = useCallback(() => {
    const id = joinId.trim();
    if (!id) return;
    setJoinId('');
    router.push(`/(tabs)/discover/circle/${encodeURIComponent(id)}`);
  }, [joinId, router]);

  const canSubmit = joinId.trim().length > 0;

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <NavHeader title={t('contacts.circles', { defaultValue: '圈子' })} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 粘贴好友分享的圈子 ID → 打开该圈子详情（在那里加入） */}
        <View style={s.joinRow}>
          <TextInput
            style={[
              s.joinInput,
              {
                borderColor: colors.surfaceBorder,
                color: colors.text,
                backgroundColor: colors.surface,
              },
            ]}
            placeholder={t('circle.joinByIdPlaceholder', {
              defaultValue: '粘贴圈子 ID 加入',
            })}
            placeholderTextColor={colors.textSecondary}
            value={joinId}
            onChangeText={setJoinId}
            onSubmitEditing={handleOpenById}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[
              s.joinBtn,
              { backgroundColor: canSubmit ? colors.primary : colors.surfaceBorder },
            ]}
            onPress={canSubmit ? handleOpenById : undefined}
            disabled={!canSubmit}
          >
            <Text style={[s.joinBtnText, { color: colors.white }]}>
              {t('circle.joinByIdButton', { defaultValue: '加入' })}
            </Text>
          </Pressable>
        </View>

        <MyCirclesPanel />
      </ScrollView>
    </View>
  );
}
