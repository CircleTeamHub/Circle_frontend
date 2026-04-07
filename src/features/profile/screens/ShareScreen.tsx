import { useCallback, useMemo } from 'react';
import {
  Alert,
  Share,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const INVITE_CODE = 'CIRCLE-134273011';
const INVITE_URL = `https://circle.im/invite?code=${INVITE_CODE}`;

const s = StyleSheet.create({
  qrSection: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  qrCard: {
    width: 220,
    height: 220,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inviteBlock: {
    gap: Spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  actionTextWrap: {
    flex: 1,
    gap: 2,
  },
});

export default function ShareScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
        gap: Spacing.xl,
      },
      qrCard: {
        backgroundColor: colors.white,
      },
      qrTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      qrSubtitle: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: 'center' as const,
      },
      inviteLabel: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      inviteCode: {
        color: colors.text,
        ...Typography.h2,
      },
      actionTitle: {
        color: colors.text,
        ...Typography.body,
      },
      actionSubtitle: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
    }),
    [colors, insets.bottom],
  );

  const handleShareQr = useCallback(async () => {
    await Share.share({
      message: `加入我的 Circle：${INVITE_URL}，邀请码：${INVITE_CODE}`,
    });
  }, []);

  const handleCopyInviteCode = useCallback(async () => {
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(INVITE_CODE);
      Alert.alert('已复制', '邀请码已复制到剪贴板');
      return;
    } catch {
      await Share.share({
        message: `邀请码：${INVITE_CODE}`,
      });
      Alert.alert(
        '当前环境不支持直接复制',
        '已打开系统分享，你也可以手动复制邀请码',
      );
    }
  }, []);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="分享" />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.qrSection}>
          <Text style={d.qrTitle}>分享我的二维码</Text>
          <View style={[s.qrCard, d.qrCard]}>
            <QRCode value={INVITE_URL} size={164} color="#111111" backgroundColor="#FFFFFF" />
          </View>
          <Text style={d.qrSubtitle}>
            扫码即可查看我的邀请信息，加入后可直接进入 Circle
          </Text>
        </View>

        <View style={s.inviteBlock}>
          <Text style={d.inviteLabel}>邀请码</Text>
          <Text style={d.inviteCode}>{INVITE_CODE}</Text>
        </View>

        <View>
          <Pressable style={s.actionRow} onPress={handleShareQr}>
            <Ionicons name="qr-code-outline" size={22} color={colors.text} />
            <View style={s.actionTextWrap}>
              <Text style={d.actionTitle}>分享二维码</Text>
              <Text style={d.actionSubtitle}>通过系统分享把二维码链接发送给好友</Text>
            </View>
          </Pressable>
          <Divider />
          <Pressable style={s.actionRow} onPress={handleCopyInviteCode}>
            <Ionicons name="copy-outline" size={22} color={colors.text} />
            <View style={s.actionTextWrap}>
              <Text style={d.actionTitle}>复制邀请码</Text>
              <Text style={d.actionSubtitle}>复制后可粘贴到聊天或其他应用</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
