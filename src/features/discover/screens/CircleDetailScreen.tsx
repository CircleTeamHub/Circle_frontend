import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { Avatar } from '@/components/ui/avatar';
import { fetchCircleDetail } from '@/services/api/circles';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { useAuthStore } from '@/stores/authStore';
import type { CircleDetail } from '@/types';

const s = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.lg, paddingBottom: 100 },
  // Header card
  profileCard: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xl,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: Radius.xl,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleName: {
    ...Typography.h2,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.xl,
  },
  statItem: {
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    ...Typography.h3,
  },
  statLabel: {
    ...Typography.caption,
  },
  categoriesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    justifyContent: 'center',
  },
  categoryChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  // Sections
  section: {
    marginTop: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: '600',
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
  },
  // Description / Rules
  textBlock: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
  },
  textContent: {
    ...Typography.bodyRegular,
    lineHeight: 21,
  },
  // Tags
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  tagChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  // Actions
  actionRow: {
    marginTop: Spacing.xl,
    gap: Spacing.md,
  },
  actionBtn: {
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    ...Typography.body,
    fontWeight: '600',
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function CircleDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const fetchMyCircles = useCirclesStore((s) => s.fetchMyCircles);

  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCircle = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchCircleDetail(id);
      setCircle(data);
    } catch {
      Alert.alert('错误', '无法加载圈子信息');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCircle();
  }, [loadCircle]);

  const isOwnerOrAdmin =
    circle?.myRole === 'OWNER' || circle?.myRole === 'ADMIN';

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      circleName: { color: colors.text },
      statValue: { color: colors.text },
      statLabel: { color: colors.textSecondary },
      sectionTitle: { color: colors.textSecondary },
      sectionCard: { backgroundColor: colors.surface },
      textContent: { color: colors.text },
      textPlaceholder: { color: colors.textSecondary },
      categoryChip: { backgroundColor: colors.primaryLight },
      categoryText: { color: colors.primary, ...Typography.caption },
      tagChip: { backgroundColor: colors.primaryLight },
      tagText: { color: colors.primary, ...Typography.caption },
      avatarPlaceholder: { backgroundColor: colors.surfaceBorder },
      avatarEditBadge: { backgroundColor: colors.primary },
      chatBtn: { backgroundColor: colors.primary },
      chatBtnText: { color: colors.white },
      adminBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
      adminBtnText: { color: colors.text },
      dangerBtn: { backgroundColor: colors.error },
      dangerBtnText: { color: colors.white },
    }),
    [colors],
  );

  if (loading) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title="圈子详情" />
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!circle) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title="圈子详情" />
        <View style={s.centerLoader}>
          <Text style={{ color: colors.textSecondary }}>圈子不存在</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title="圈子详情"
        rightIcon={isOwnerOrAdmin ? 'create-outline' : undefined}
        onRightPress={
          isOwnerOrAdmin
            ? () => Alert.alert('编辑', '圈子编辑功能开发中')
            : undefined
        }
      />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile Card ── */}
        <View style={s.profileCard}>
          {/* Avatar */}
          <View style={s.avatarWrap}>
            {circle.avatarUrl ? (
              <Image
                source={{ uri: circle.avatarUrl }}
                style={s.avatarImage}
                contentFit="cover"
              />
            ) : (
              <View style={[s.avatarPlaceholder, d.avatarPlaceholder]}>
                <Ionicons name="people" size={36} color={colors.textSecondary} />
              </View>
            )}
            {isOwnerOrAdmin ? (
              <View style={[s.avatarEditBadge, d.avatarEditBadge]}>
                <Ionicons name="camera" size={12} color={colors.white} />
              </View>
            ) : null}
          </View>

          {/* Name */}
          <Text style={[s.circleName, d.circleName]}>{circle.name}</Text>

          {/* Categories */}
          {circle.categories.length > 0 ? (
            <View style={s.categoriesRow}>
              {circle.categories.map((c) => (
                <View key={c} style={[s.categoryChip, d.categoryChip]}>
                  <Text style={d.categoryText}>{c}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Stats */}
          <View style={s.statsRow}>
            <View style={s.statItem}>
              <Text style={[s.statValue, d.statValue]}>{circle.memberCount}</Text>
              <Text style={[s.statLabel, d.statLabel]}>成员</Text>
            </View>
            <View style={s.statItem}>
              <Text style={[s.statValue, d.statValue]}>{circle.postCount}</Text>
              <Text style={[s.statLabel, d.statLabel]}>帖子</Text>
            </View>
          </View>
        </View>

        <Divider />

        {/* ── 圈子描述 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>圈子描述</Text>
          <View style={[s.textBlock, d.sectionCard]}>
            <Text style={[s.textContent, circle.description ? d.textContent : d.textPlaceholder]}>
              {circle.description || '暂无描述'}
            </Text>
          </View>
        </View>

        {/* ── 圈子公告与规则 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>公告与规则</Text>
          <View style={[s.textBlock, d.sectionCard]}>
            <Text style={[s.textContent, circle.rules ? d.textContent : d.textPlaceholder]}>
              {circle.rules || '暂无公告'}
            </Text>
          </View>
        </View>

        {/* ── 标签 ── */}
        {circle.tags.length > 0 ? (
          <View style={s.section}>
            <Text style={[s.sectionTitle, d.sectionTitle]}>标签</Text>
            <View style={s.tagsRow}>
              {circle.tags.map((tag) => (
                <View key={tag} style={[s.tagChip, d.tagChip]}>
                  <Text style={d.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── 圈子设置 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>圈子设置</Text>
          <View style={[s.sectionCard, d.sectionCard]}>
            <MenuRow
              icon="location-outline"
              label="关联城市"
              rightText={circle.cities.length > 0 ? circle.cities.join('、') : '全国'}
            />
            <Divider />
            <MenuRow
              icon="diamond-outline"
              label="加入VIP限制"
              rightText={circle.joinVipRestriction != null ? `VIP${circle.joinVipRestriction}+` : '不限制'}
            />
            <Divider />
            <MenuRow
              icon="shield-checkmark-outline"
              label="加入信用值限制"
              rightText={circle.joinCreditRestriction != null ? `${circle.joinCreditRestriction}分以上` : '不限制'}
            />
            <Divider />
            <MenuRow
              icon="sparkles-outline"
              label="需要靓号"
              rightText={circle.joinFancyRestriction ? '是' : '否'}
            />
            <Divider />
            <MenuRow
              icon="create-outline"
              label="成员可发帖"
              rightText={circle.memberCanPost ? '允许' : '仅管理员'}
            />
          </View>
        </View>

        {/* ── Actions ── */}
        <View style={s.actionRow}>
          {/* 进入群聊 */}
          {circle.groupID ? (
            <Pressable
              style={[s.actionBtn, d.chatBtn]}
              onPress={() => {
                router.push({
                  pathname: '/(tabs)/messages/chat-detail',
                  params: {
                    sourceID: circle.groupID!,
                    conversationType: 'group',
                    title: circle.name,
                  },
                });
              }}
            >
              <Text style={[s.actionBtnText, d.chatBtnText]}>进入群聊</Text>
            </Pressable>
          ) : null}

          {/* 入圈审核 (admin only) */}
          {isOwnerOrAdmin ? (
            <Pressable
              style={[s.actionBtn, d.adminBtn]}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/discover/circle/[id]/admin',
                  params: { id: circle.id },
                })
              }
            >
              <Text style={[s.actionBtnText, d.adminBtnText]}>入圈审核</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
