import { useCallback } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import { MenuRow } from '@/components/ui/menu-row';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: { flex: 1 },
  menu: {
    marginTop: Spacing.lg,
    marginHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
});

// Entry menu for "邀请好友": choose between copying the circle's info to share
// out of band, or picking from your contacts (which opens the friend picker).
export default function InviteCircleMenuScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; title?: string }>();
  const circleId = typeof params.id === 'string' ? params.id : '';
  const circleName = typeof params.title === 'string' ? params.title : '';

  const handleCopyInfo = useCallback(async () => {
    if (!circleId) return;
    const text = t('circle.shareText', {
      name: circleName,
      id: circleId,
      defaultValue: `邀请你加入圈子「${circleName}」\n圈子ID：${circleId}\n在风信「联系人 → 圈子 → 加入圈子」粘贴此 ID 即可加入`,
    });
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(text);
      Alert.alert(
        t('circle.copied', {
          defaultValue: '圈子信息已复制，发给好友即可邀请加入',
        }),
      );
    } catch {
      Alert.alert(t('circle.copyFailed', { defaultValue: '复制失败' }));
    }
  }, [circleId, circleName, t]);

  const handleInviteContacts = useCallback(() => {
    router.push({
      pathname: '/(tabs)/discover/circle/[id]/invite-friends',
      params: { id: circleId, title: circleName },
    });
  }, [circleId, circleName, router]);

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <NavHeader title={t('circle.invite.entry', { defaultValue: '邀请好友' })} />
      <View style={[s.menu, { backgroundColor: colors.surface }]}>
        <MenuRow
          icon="copy-outline"
          label={t('circle.invite.copyInfo', { defaultValue: '复制圈子信息' })}
          onPress={handleCopyInfo}
        />
        <Divider />
        <MenuRow
          icon="people-outline"
          label={t('circle.invite.fromContacts', {
            defaultValue: '邀请通讯录好友',
          })}
          onPress={handleInviteContacts}
        />
      </View>
    </View>
  );
}
