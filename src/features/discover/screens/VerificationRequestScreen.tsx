import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { fetchInvitation, respondToVerification } from '@/services/api/circles';
import type { CircleInvitation } from '@/types';

const s = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    paddingTop: Spacing.xl,
  },
  card: {
    width: '100%',
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  nameText: {
    ...Typography.h2,
  },
  descText: {
    ...Typography.body,
    textAlign: 'center',
  },
  progressText: {
    ...Typography.caption,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.lg,
    width: '100%',
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    ...Typography.body,
    fontWeight: '600',
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
});

export default function VerificationRequestScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invitation, setInvitation] = useState<CircleInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);
  const [responded, setResponded] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const data = await fetchInvitation(id);
        setInvitation(data);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      card: { backgroundColor: colors.surface },
      nameText: { color: colors.text },
      descText: { color: colors.textSecondary },
      progressText: { color: colors.primary },
      approveBtn: { backgroundColor: colors.primary },
      rejectBtn: { backgroundColor: colors.surfaceBorder },
      approveBtnText: { color: colors.white },
      rejectBtnText: { color: colors.text },
    }),
    [colors],
  );

  const handleRespond = useCallback(
    async (approve: boolean) => {
      if (!id || responding) return;
      setResponding(true);
      try {
        await respondToVerification(id, approve);
        setResponded(true);
        Alert.alert(approve ? '已同意' : '已拒绝', undefined, [
          { text: '确定', onPress: () => router.back() },
        ]);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : '操作失败';
        Alert.alert('操作失败', message);
      } finally {
        setResponding(false);
      }
    },
    [id, responding, router],
  );

  if (loading) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title="圈子验证请求" />
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!invitation) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title="圈子验证请求" />
        <View style={s.centerLoader}>
          <Text style={d.descText}>验证请求不存在</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="圈子验证请求" />
      <View style={s.content}>
        <View style={[s.card, d.card]}>
          <Avatar
            size={64}
            name={invitation.applicant.nickname}
            uri={invitation.applicant.avatarUrl ?? undefined}
          />
          <Text style={[s.nameText, d.nameText]}>
            {invitation.applicant.nickname}
          </Text>
          <Text style={[s.descText, d.descText]}>
            想要加入【{invitation.circleName}】
          </Text>
          <Text style={[s.descText, d.descText]}>
            由 {invitation.inviter.nickname} 邀请
          </Text>
          <Text style={[s.progressText, d.progressText]}>
            验证进度: {invitation.approvedCount}/{invitation.requiredCount}
          </Text>
        </View>

        {!responded ? (
          <View style={s.buttonRow}>
            <Pressable
              style={[s.btn, d.rejectBtn]}
              onPress={() => handleRespond(false)}
              disabled={responding}
            >
              <Text style={[s.btnText, d.rejectBtnText]}>拒绝</Text>
            </Pressable>
            <Pressable
              style={[s.btn, d.approveBtn]}
              onPress={() => handleRespond(true)}
              disabled={responding}
            >
              {responding ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={[s.btnText, d.approveBtnText]}>同意</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={s.doneRow}>
            <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
            <Text style={{ color: '#22C55E', ...Typography.body }}>已完成</Text>
          </View>
        )}
      </View>
    </View>
  );
}
