import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { Avatar } from '@/components/ui/avatar';
import {
  fetchCircleDetail,
  selectCircleIcon,
  uploadCircleIcon,
} from '@/services/api/circles';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import { useAuthStore } from '@/stores/authStore';
import { getOrCreateGroupConversation } from '@/im/client';
import { shouldOpenChatPreview } from '@/features/chat/chat-preview';
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
  summaryCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
  },
  summaryRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  summaryLabel: {
    ...Typography.body,
    flex: 1,
  },
  summaryValue: {
    ...Typography.caption,
    flexShrink: 1,
    textAlign: 'right',
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
  iconSection: {
    gap: Spacing.sm,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  iconAssetCard: {
    width: 88,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    gap: Spacing.xs,
    alignItems: 'center',
    borderWidth: 1,
  },
  iconAssetPreview: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconAssetImage: {
    width: '100%',
    height: '100%',
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

  const [circle, setCircle] = useState<CircleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [iconSaving, setIconSaving] = useState(false);
  const [enteringGroupChat, setEnteringGroupChat] = useState(false);
  const mountedRef = useRef(true);

  // 进入圈子群聊：先解析出会话 ID（否则聊天页拿不到 conversationID 会停在预览模式），
  // 再入 discover 栈，返回时回到圈子详情。
  const handleEnterGroupChat = useCallback(async () => {
    const groupID = circle?.groupID;
    if (!groupID || enteringGroupChat) return;
    try {
      setEnteringGroupChat(true);
      const conversation = await getOrCreateGroupConversation(groupID);
      router.push({
        pathname: '/(tabs)/discover/chat-detail',
        params: {
          conversationID: conversation.conversationID,
          sourceID: groupID,
          conversationType: 'group',
          title: circle?.name ?? '',
        },
      });
    } catch (error) {
      if (shouldOpenChatPreview(error)) {
        // IM 未接通：退化成预览模式（无 conversationID）。
        router.push({
          pathname: '/(tabs)/discover/chat-detail',
          params: {
            sourceID: groupID,
            conversationType: 'group',
            title: circle?.name ?? '',
          },
        });
        return;
      }
      Alert.alert(t('circle.error'), t('common.networkError'));
    } finally {
      if (mountedRef.current) setEnteringGroupChat(false);
    }
  }, [circle?.groupID, circle?.name, enteringGroupChat, router, t]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCircle = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchCircleDetail(id);
      setCircle(data);
    } catch {
      Alert.alert(t('circle.error'), t('circle.loadError'));
      setCircle(null);
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useFocusEffect(
    useCallback(() => {
      void loadCircle();
    }, [loadCircle]),
  );

  const isOwnerOrAdmin =
    circle?.myRole === 'OWNER' || circle?.myRole === 'ADMIN';

  const handleSelectCircleIcon = useCallback(
    async (iconAssetId: string) => {
      if (!id || !isOwnerOrAdmin || iconSaving) {
        return;
      }

      try {
        setIconSaving(true);
        await selectCircleIcon(id, iconAssetId);
        if (mountedRef.current) {
          await loadCircle();
        }
      } catch (error) {
        if (mountedRef.current) {
          Alert.alert(
            t('circle.error'),
            error instanceof Error ? error.message : t('circle.loadError'),
          );
        }
      } finally {
        if (mountedRef.current) {
          setIconSaving(false);
        }
      }
    },
    [iconSaving, id, isOwnerOrAdmin, loadCircle, t],
  );

  const handleUploadCircleIcon = useCallback(async () => {
    if (!id || !isOwnerOrAdmin || iconSaving) {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (result.canceled || !result.assets.length) {
      return;
    }

    const asset = result.assets[0];
    const contentType = resolveUploadContentType({
      mimeType: asset.mimeType,
      fileName: asset.fileName,
    });

    if (!contentType || !asset.uri) {
      Alert.alert(
        t('circle.error'),
        t('circle.icon.unknownImageFormat', {
          defaultValue: '无法识别图片格式',
        }),
      );
      return;
    }

    try {
      setIconSaving(true);
      const presign = await requestUploadPresign({
        filename: sanitizeUploadFilename(asset.fileName ?? 'circle-icon.jpg'),
        contentType,
        folder: 'avatars',
      });
      await uploadLocalFileToPresignedUrl(presign.uploadUrl, contentType, asset.uri);
      const created = await uploadCircleIcon(id, {
        imageUrl: presign.fileUrl,
        name: circle?.name ? `${circle.name}-icon` : 'circle-icon',
      });
      await selectCircleIcon(id, created.id);
      if (mountedRef.current) {
        await loadCircle();
      }
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert(
          t('circle.error'),
          error instanceof Error ? error.message : t('circle.loadError'),
        );
      }
    } finally {
      if (mountedRef.current) {
        setIconSaving(false);
      }
    }
  }, [circle?.name, iconSaving, id, isOwnerOrAdmin, loadCircle, t]);

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
      summaryLabel: { color: colors.text },
      summaryValue: { color: colors.textSecondary },
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
      iconAssetCard: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      iconAssetCardSelected: {
        backgroundColor: colors.primaryLight,
        borderColor: colors.primary,
      },
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
            ? () =>
                router.push({
                  pathname: '/(tabs)/discover/circle/[id]/edit',
                  params: { id: circle.id },
                })
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

        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>
            {t('circle.icon.sectionTitle', { defaultValue: '圈子图标' })}
          </Text>
          <View style={[s.sectionCard, d.sectionCard, s.iconSection]}>
            <View style={s.iconGrid}>
              {circle.currentIconUrl ? (
                <View style={[s.iconAssetCard, d.iconAssetCard]}>
                  <View style={s.iconAssetPreview}>
                    <Image source={{ uri: circle.currentIconUrl }} style={s.iconAssetImage} contentFit="cover" />
                  </View>
                  <Text style={{ color: colors.text }}>
                    {t('circle.icon.current', { defaultValue: '当前图标' })}
                  </Text>
                </View>
              ) : null}
              {isOwnerOrAdmin
                ? circle.availableIconAssets?.map((asset) => {
                    const selected = asset.id === circle.currentIconAssetID;
                    return (
                      <Pressable
                        key={asset.id}
                        style={[
                          s.iconAssetCard,
                          d.iconAssetCard,
                          selected ? d.iconAssetCardSelected : null,
                        ]}
                        onPress={() => handleSelectCircleIcon(asset.id)}
                      >
                        <View style={s.iconAssetPreview}>
                          {asset.imageUrl ? (
                            <Image
                              source={{ uri: asset.imageUrl }}
                              style={s.iconAssetImage}
                              contentFit="cover"
                            />
                          ) : (
                            <Ionicons
                              name="sparkles-outline"
                              size={22}
                              color={colors.textSecondary}
                            />
                          )}
                        </View>
                        <Text style={{ color: colors.text }} numberOfLines={1}>
                          {asset.name}
                        </Text>
                      </Pressable>
                    );
                  })
                : null}
            </View>
            {isOwnerOrAdmin ? (
              <Pressable
                style={[s.actionBtn, d.adminBtn]}
                onPress={handleUploadCircleIcon}
                disabled={iconSaving}
              >
                <Text style={d.adminBtnText}>
                  {iconSaving
                    ? t('circle.icon.uploading', { defaultValue: '上传中...' })
                    : t('circle.icon.upload', { defaultValue: '上传圈子图标' })}
                </Text>
              </Pressable>
            ) : null}
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

        {/* ── 入圈规则摘要 ── */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, d.sectionTitle]}>{t('circle.rulesSummary')}</Text>
          <View style={[s.summaryCard, d.sectionCard]}>
            {[
              {
                key: 'cities',
                label: t('circle.relatedCities'),
                value:
                  circle.cities.length > 0
                    ? circle.cities.join('、')
                    : t('common.nationwide'),
              },
              {
                key: 'vip',
                label: t('circle.joinVipRestriction'),
                value:
                  circle.joinVipRestriction != null
                    ? `VIP${circle.joinVipRestriction}+`
                    : t('common.noRestriction'),
              },
              {
                key: 'credit',
                label: t('circle.joinCreditRestriction'),
                value:
                  circle.joinCreditRestriction != null
                    ? t('circle.creditSuffix', {
                        score: circle.joinCreditRestriction,
                      })
                    : t('common.noRestriction'),
              },
              {
                key: 'fancy',
                label: t('circle.fancyRequired'),
                value: circle.joinFancyRestriction
                  ? t('common.yes')
                  : t('common.no'),
              },
              {
                key: 'memberCanPost',
                label: t('circle.memberCanPost'),
                value: circle.memberCanPost
                  ? t('circle.allowed')
                  : t('circle.adminOnly'),
              },
            ].map((row, index, rows) => (
              <View key={row.key}>
                <View style={s.summaryRow}>
                  <Text style={[s.summaryLabel, d.summaryLabel]}>
                    {row.label}
                  </Text>
                  <Text style={[s.summaryValue, d.summaryValue]}>
                    {row.value}
                  </Text>
                </View>
                {index < rows.length - 1 ? <Divider /> : null}
              </View>
            ))}
          </View>
        </View>

        {/* ── Actions ── */}
        <View style={s.actionRow}>
          {/* 进入群聊 */}
          {circle.groupID ? (
            <Pressable
              style={[s.actionBtn, d.chatBtn]}
              onPress={handleEnterGroupChat}
              disabled={enteringGroupChat}
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
