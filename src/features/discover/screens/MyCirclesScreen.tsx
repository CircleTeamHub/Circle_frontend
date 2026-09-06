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
import { useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import {
  getCircleNotificationSettingsHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { MyCirclesPanel } from '@/features/discover/components/my-circles-panel';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

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
  const segments = useSegments();
  const [joinId, setJoinId] = useState('');

  // 圈子通知设置此前只有 CircleManagementScreen 一个入口，而 #195 把发现页那行
  // 「圈子管理」删掉之后再没有任何地方 push 到它 —— 设置页就此从 App 里消失。
  // 挂回圈子页的齿轮位，并按当前栈解析路由，免得从联系人页点进去被甩到发现 tab。
  const handleOpenNotificationSettings = useCallback(() => {
    router.push(
      getCircleNotificationSettingsHref(
        getUserProfileScopeFromSegments(segments),
      ),
    );
  }, [router, segments]);

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
      <NavHeader
        title={t('contacts.circles', { defaultValue: '圈子' })}
        rightIcon="settings-outline"
        onRightPress={handleOpenNotificationSettings}
        rightAccessibilityLabel={t('discover.notifications.title')}
      />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
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
