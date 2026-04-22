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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      Alert.alert(t('circle.error'), t('circle.loadError'));
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
        <NavHeader title={t('circle.detail')} />
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!circle) {
    return (
      <View style={[d.container, { paddingTop: insets.top }]}>
        <NavHeader title={t('circle.detail')} />
        <View style={s.centerLoader}>
          <Text style={{ color: colors.textSecondary }}>{t('circle.notExist')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('circle.detail')}
        rightIcon={isOwnerOrAdmin ? 'create-outline' : undefined}
        onRightPress={
          isOwnerOrAdmin
            ? () => Alert.alert(t('circle.edit'), t('circle.editInProgress'))
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
              <Text style={[s.statLabel, d.statLabel]}>{t('circle.members')}</Text>
            </View>
            <View style={s.statItem}>
              <Text style={[s.statValue, d.statValue]}>{circle.postCount}</Text>
              <Text style={[s.statLabel, d.statLabel]}>{t('circle.posts')}</Text>
            </View>
          </View>
        </View>

        <Divider />

        {/* ── 圈子描述 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.description')}</Text>
          <View style={[s.textBlock, d.sectionCard]}>
            <Text style={[s.textContent, circle.description ? d.textContent : d.textPlaceholder]}>
              {circle.description || t('circle.noDescription')}
            </Text>
          </View>
        </View>

        {/* ── 圈子公告与规则 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.rules')}</Text>
          <View style={[s.textBlock, d.sectionCard]}>
            <Text style={[s.textContent, circle.rules ? d.textContent : d.textPlaceholder]}>
              {circle.rules || t('circle.noRules')}
            </Text>
          </View>
        </View>

        {/* ── 标签 ── */}
        {circle.tags.length > 0 ? (
          <View style={s.section}>
            <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.tagsLabel')}</Text>
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
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.settings')}</Text>
          <View style={[s.sectionCard, d.sectionCard]}>
            <MenuRow
              icon="location-outline"
              label={t('circle.relatedCities')}
              rightText={circle.cities.length > 0 ? circle.cities.join('、') : t('common.nationwide')}
            />
            <Divider />
            <MenuRow
              icon="diamond-outline"
              label={t('circle.joinVipRestriction')}
              rightText={circle.joinVipRestriction != null ? `VIP${circle.joinVipRestriction}+` : t('common.noRestriction')}
            />
            <Divider />
            <MenuRow
              icon="shield-checkmark-outline"
              label={t('circle.joinCreditRestriction')}
              rightText={circle.joinCreditRestriction != null ? t('circle.creditSuffix', { score: circle.joinCreditRestriction }) : t('common.noRestriction')}
            />
            <Divider />
            <MenuRow
              icon="sparkles-outline"
              label={t('circle.fancyRequired')}
              rightText={circle.joinFancyRestriction ? t('common.yes') : t('common.no')}
            />
            <Divider />
            <MenuRow
              icon="create-outline"
              label={t('circle.memberCanPost')}
              rightText={circle.memberCanPost ? t('circle.allowed') : t('circle.adminOnly')}
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
              <Text style={[s.actionBtnText, d.chatBtnText]}>{t('circle.enterGroupChat')}</Text>
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
              <Text style={[s.actionBtnText, d.adminBtnText]}>{t('circle.adminReview')}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
