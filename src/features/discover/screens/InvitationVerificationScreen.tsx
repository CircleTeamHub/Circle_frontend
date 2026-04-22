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
import { fetchInvitation } from '@/services/api/circles';
import type { CircleInvitation, CircleInvitationVerifier } from '@/types';

const TOTAL_SLOTS = 10;

const s = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginVertical: Spacing.lg,
  },
  progressText: {
    ...Typography.h2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  slot: {
    width: 60,
    height: 76,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  slotCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotLabel: {
    ...Typography.tinyRegular,
    textAlign: 'center',
  },
  statusBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    marginTop: Spacing.xl,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    ...Typography.body,
    fontWeight: '600',
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    ...Typography.caption,
    textAlign: 'center',
  },
});

export default function InvitationVerificationScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invitation, setInvitation] = useState<CircleInvitation | null>(null);
  const [loading, setLoading] = useState(true);

  const loadInvitation = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchInvitation(id);
      setInvitation(data);
    } catch {
      Alert.alert('错误', '无法加载验证信息');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadInvitation();
  }, [loadInvitation]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      progressText: { color: colors.primary },
      subtitle: { color: colors.textSecondary },
      slotCircle: { borderColor: colors.surfaceBorder },
      slotLabel: { color: colors.textSecondary },
      addButton: { backgroundColor: colors.primary },
      addButtonText: { color: colors.white },
    }),
    [colors],
  );

  if (loading) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title="入圈验证" />
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!invitation) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title="入圈验证" />
        <View style={s.centerLoader}>
          <Text style={d.subtitle}>验证信息不存在</Text>
        </View>
      </View>
    );
  }

  // Build 10 slots from verifiers
  const filledSlots: (CircleInvitationVerifier | null)[] = [
    ...invitation.verifiers,
    ...Array(Math.max(0, TOTAL_SLOTS - invitation.verifiers.length)).fill(null),
  ].slice(0, TOTAL_SLOTS);

  const canAddMore =
    invitation.status === 'PENDING' &&
    invitation.verifiers.filter((v) => v.status !== 'REJECTED').length < TOTAL_SLOTS;

  const handleAddVerifier = () => {
    router.push({
      pathname: '/(tabs)/discover/invitation/[id]/select-verifier',
      params: { id: invitation.id, circleId: invitation.circleId },
    });
  };

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={`加入【${invitation.circleName}】`} />
      <View style={s.content}>
        <Text style={[s.subtitle, d.subtitle]}>
          需要{TOTAL_SLOTS}位圈内成员验证
        </Text>

        <View style={s.progressRow}>
          <Text style={[s.progressText, d.progressText]}>
            已通过 {invitation.approvedCount}/{TOTAL_SLOTS}
          </Text>
        </View>

        {/* 10 slot grid */}
        <View style={s.grid}>
          {filledSlots.map((slot, i) => {
            if (!slot) {
              // Empty slot
              return (
                <Pressable
                  key={`empty-${i}`}
                  style={s.slot}
                  onPress={canAddMore ? handleAddVerifier : undefined}
                >
                  <View style={[s.slotCircle, d.slotCircle]}>
                    {canAddMore ? (
                      <Ionicons name="add" size={22} color={colors.textSecondary} />
                    ) : null}
                  </View>
                  <Text style={[s.slotLabel, d.slotLabel]}>
                    {canAddMore ? '添加' : '空位'}
                  </Text>
                </Pressable>
              );
            }

            // Filled slot
            const statusIcon =
              slot.status === 'APPROVED'
                ? { name: 'checkmark-circle', color: '#22C55E' }
                : slot.status === 'REJECTED'
                  ? { name: 'close-circle', color: colors.error }
                  : { name: 'time', color: colors.warning };

            return (
              <View key={slot.id} style={s.slot}>
                <View>
                  <Avatar
                    size={52}
                    name={slot.verifier.nickname}
                    uri={slot.verifier.avatarUrl ?? undefined}
                  />
                  <View
                    style={[
                      s.statusBadge,
                      { backgroundColor: colors.background },
                    ]}
                  >
                    <Ionicons
                      name={statusIcon.name as any}
                      size={16}
                      color={statusIcon.color}
                    />
                  </View>
                </View>
                <Text
                  style={[s.slotLabel, d.slotLabel]}
                  numberOfLines={1}
                >
                  {slot.verifier.nickname}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Add verifier button */}
        {canAddMore ? (
          <Pressable
            style={[s.addButton, d.addButton]}
            onPress={handleAddVerifier}
          >
            <Text style={[s.addButtonText, d.addButtonText]}>
              邀请好友验证
            </Text>
          </Pressable>
        ) : null}

        {invitation.status === 'APPROVED' || invitation.status === 'ADMIN_APPROVED' ? (
          <View style={[s.progressRow, { marginTop: Spacing.xl }]}>
            <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
            <Text style={{ color: '#22C55E', ...Typography.body, fontWeight: '600' }}>
              验证通过，已加入圈子
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
