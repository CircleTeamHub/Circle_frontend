import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  getCircleInviteFriendsHref,
  getCircleScopeFromSegments,
  getCircleShareHref,
} from '@/features/user/utils/routes';
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

// Entry menu for "邀请好友": send the circle as a chat card, or pick from your
// contacts (which opens the in-app friend picker / invitation flow).
export default function InviteCircleMenuScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string;
    title?: string;
    avatar?: string;
  }>();
  const circleId = typeof params.id === 'string' ? params.id : '';
  const circleName = typeof params.title === 'string' ? params.title : '';
  const circleAvatar = typeof params.avatar === 'string' ? params.avatar : '';
  // 留在当前栈（messages/discover 均有本页镜像），返回链路不跨 tab。
  const segments = useSegments();
  const circleScope = getCircleScopeFromSegments(segments);

  const handleSendCard = useCallback(() => {
    router.push(
      getCircleShareHref(circleScope, circleId, circleName, circleAvatar),
    );
  }, [circleScope, circleId, circleName, circleAvatar, router]);

  const handleInviteContacts = useCallback(() => {
    router.push(getCircleInviteFriendsHref(circleScope, circleId, circleName));
  }, [circleScope, circleId, circleName, router]);

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
          icon="share-social-outline"
          label={t('circle.invite.sendCard', { defaultValue: '发送圈子名片' })}
          onPress={handleSendCard}
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
