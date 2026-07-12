import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { NavHeader } from '@/components/ui/nav-header';
import { UserIconRow } from '@/components/ui/user-icon-row';
import { shouldOpenChatPreview } from '@/features/chat/chat-preview';
import { getOrCreateSingleConversation } from '@/im/client';
import { getProfileSignature } from '@/features/profile/profile-display';
import { Radius, Spacing, Typography, useTheme, type ThemeColors } from '@/theme';
import {
  ProfileActionRow,
  ICON_BADGE_SIZE,
  ROW_PADDING_H,
  ROW_GAP,
} from '@/features/user/components/profile-action-row';
import type { UserProfileData } from '@/features/user/data/profiles';
import {
  canOpenSendFriendRequest,
  getProfileMetaItems,
  isCurrentUserProfile,
} from '@/features/user/profile-view';
import {
  getChatInfoHref,
  getChatDetailHref,
  getEditFriendRemarkHref,
  getEditFriendTagsHref,
  getSendFriendRequestHref,
  getUserMomentsHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import {
  fetchFriendSettings,
  fetchFriendStatus,
  type FriendSettings,
  type FriendStatus,
} from '@/services/api/friends';
import { fetchUserProfile } from '@/services/api/profile';
import { useAuthStore } from '@/stores/authStore';
import { useFriendRemarkStore } from '@/stores/friendRemarkStore';

const INFO_ROW_IDS = [
  'moments',
  'setRemark',
  'tags',
  'description',
  'permission',
  'giftCoins',
  'moreInfo',
] as const;
const NON_FRIEND_INFO_ROW_IDS = ['moments', 'giftCoins', 'moreInfo'] as const;
const SELF_INFO_ROW_IDS = ['moments'] as const;

type InfoRowId = (typeof INFO_ROW_IDS)[number];

// 资料行按语义分成多张卡片渲染（卡间留白），避免全部挤在一张长卡里。
// 顺序沿用 INFO_ROW_IDS，只在语义边界处切开：内容 / 我的标注 / 权限与更多。
const INFO_ROW_GROUPS = [
  ['moments'],
  ['setRemark', 'tags', 'description'],
  ['permission', 'giftCoins', 'moreInfo'],
] as const;

interface InfoRowItem {
  id: InfoRowId;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  value?: string;
  onPress?: () => void;
}

// 每行的图标与主题配色（彩色圆角图标块 + 白色字形，iOS 设置风）
const ROW_ICON: Record<InfoRowId, keyof typeof Ionicons.glyphMap> = {
  moments: 'images',
  setRemark: 'create',
  tags: 'pricetags',
  description: 'document-text',
  permission: 'eye',
  giftCoins: 'gift',
  moreInfo: 'information-circle',
};

const ROW_COLOR: Record<InfoRowId, keyof ThemeColors> = {
  moments: 'blue',
  setRemark: 'primary',
  tags: 'success',
  description: 'orange',
  permission: 'deepPurple',
  giftCoins: 'warning',
  moreInfo: 'purple',
};

const AVATAR_SIZE = 72;
const CARD_GAP = 12; // 分组卡片之间的垂直留白
const RECOGNITION_COUNT_ICON_SOURCE = require('../../../../assets/images/like-outline.png');

const s = StyleSheet.create({
  // 居中身份 Hero：头像 → 名字/标签 → 账号 → 性别地区 → 签名 → 徽章，逐层拉开间距。
  hero: {
    alignItems: 'center',
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  avatarRing: {
    width: AVATAR_SIZE + 10,
    height: AVATAR_SIZE + 10,
    borderRadius: Radius.xxl + 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  avatarFrame: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: Radius.xxl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  identity: {
    alignItems: 'center',
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  badge: {
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  metaChip: {
    borderRadius: Radius.full,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  signature: {
    textAlign: 'center',
    paddingHorizontal: Spacing.md,
  },
  badgeIconRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  recognitionPill: {
    minWidth: 58,
    height: 32,
    borderRadius: Radius.full,
    paddingLeft: 6,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  recognitionIconImage: {
    width: 18,
    height: 18,
  },
  // 资料行按语义拆成多张分组卡片，卡间留白；卡内行间用内缩分隔线（左缩进对齐文字起点）。
  sections: {
    gap: CARD_GAP,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: ROW_PADDING_H + ICON_BADGE_SIZE + ROW_GAP,
  },
  photoNotesTitle: {
    ...Typography.small,
    fontWeight: '600',
    paddingHorizontal: ROW_PADDING_H,
    paddingTop: Spacing.md,
  },
  photoNotesStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    padding: ROW_PADDING_H,
  },
  photoNote: {
    width: 76,
    height: 76,
    borderRadius: Radius.md,
  },
  actionSection: {
    marginTop: Spacing.md,
    gap: Spacing.xs,
  },
  actionButton: {
    width: '100%',
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function UserProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const currentUser = useAuthStore((state) => state.user);
  const [remoteProfile, setRemoteProfile] = useState<UserProfileData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [friendStatus, setFriendStatus] = useState<FriendStatus | null>(null);
  const [friendStatusLoadError, setFriendStatusLoadError] = useState(false);
  const [friendSettings, setFriendSettings] = useState<FriendSettings | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const profileId =
    typeof params.id === 'string' ? params.id : 'unknown';
  const scope = getUserProfileScopeFromSegments(segments);
  const isCurrentUser = isCurrentUserProfile(profileId, currentUser);

  const remarkOverride = useFriendRemarkStore((state) =>
    isCurrentUser ? undefined : state.remarks[profileId],
  );
  // 之前的 fallback 经过 USER_PROFILES 字典（生产 bundle 里塞了 8 个写死的模拟用户：
  // "陈思琪" / "张明远" 等 + 假手机号 + Unsplash 头像）。删掉了字典；改用一个最小化的
  // synthesized fallback 直到 fetchUserProfile 完成。
  const fallbackName =
    (typeof params.name === 'string' && params.name.trim()) || t('userProfile.unknownUser', { defaultValue: '未命名用户' });
  const fallbackProfile: UserProfileData = useMemo(
    () => ({
      id: profileId,
      name: fallbackName,
      accountId: '',
      memberLabel: t('profile.normalUser'),
      badges: [],
      displayIcons: [],
      gender: null,
      city: null,
      signature: '',
      phone: '',
      likeCount: 0,
      recognitionCount: 0,
    }),
    [fallbackName, profileId, t],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      setFetchError(null);

      // params 中没有 id 时 profileId 为 'unknown'，跳过请求，使用 fallback 静态数据
      if (profileId === 'unknown') {
        return () => {
          cancelled = true;
        };
      }

      if (isCurrentUser && currentUser) {
        setFetchError(null);
        setFriendStatus(null);
        setRemoteProfile({
          id: currentUser.id,
          name: currentUser.nickname || currentUser.accountId,
          accountId: currentUser.accountId,
          avatarUrl: currentUser.avatarUrl ?? undefined,
          memberLabel: currentUser.role === 'ADMIN' ? t('profile.admin') : t('profile.normalUser'),
          badges: [currentUser.role === 'ADMIN' ? t('profile.admin') : t('profile.normalUser')],
          gender: currentUser.gender,
          city: currentUser.city,
          signature: getProfileSignature(
            currentUser.persona,
            currentUser.helloWords,
            t,
          ),
          displayIcons: currentUser.displayIcons ?? [],
          likeCount: currentUser.likeCount ?? 0,
          recognitionCount: currentUser.recognitionCount ?? 0,
          phone: currentUser.phoneNumber ?? t('userProfile.phoneHidden'),
          remarkHint: currentUser.nickname,
        });
        return () => {
          cancelled = true;
        };
      }

      fetchUserProfile(profileId)
        .then((profile) => {
          if (cancelled) {
            return;
          }

          setRemoteProfile({
            id: profile.id,
            name: profile.nickname || profile.accountId,
            accountId: profile.accountId,
            avatarUrl: profile.avatarUrl ?? undefined,
            memberLabel: profile.role === 'ADMIN' ? t('profile.admin') : t('profile.normalUser'),
            badges: [profile.role === 'ADMIN' ? t('profile.admin') : t('profile.normalUser')],
            displayIcons: profile.displayIcons ?? [],
            likeCount: profile.likeCount ?? 0,
            recognitionCount: profile.recognitionCount ?? 0,
            gender: profile.gender,
            city: profile.city,
            signature: getProfileSignature(profile.persona, profile.helloWords, t),
            phone: profile.phoneNumber ?? t('userProfile.phoneHidden'),
            remarkHint: profile.nickname,
          });
        })
        .catch((error) => {
          if (!cancelled) {
            setRemoteProfile(null);
            setFetchError(t('userProfile.loadFailed'));
          }
          if (__DEV__) {
            console.warn('[UserProfileScreen] fetchUserProfile failed', error);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [currentUser, isCurrentUser, profileId, t]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      if (profileId === 'unknown' || isCurrentUser) {
        setFriendStatusLoadError(false);
        setFriendStatus(null);
        return () => {
          cancelled = true;
        };
      }

      setFriendStatusLoadError(false);

      fetchFriendStatus(profileId)
        .then((status) => {
          if (!cancelled) {
            setFriendStatusLoadError(false);
            setFriendStatus(status.status);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setFriendStatusLoadError(true);
            setFriendStatus(null);
          }
          if (__DEV__) {
            console.warn('[UserProfileScreen] fetchFriendStatus failed', error);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [isCurrentUser, profileId]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      if (
        profileId === 'unknown' ||
        isCurrentUser ||
        friendStatus !== 'ACCEPTED'
      ) {
        setFriendSettings(null);
        return () => {
          cancelled = true;
        };
      }

      fetchFriendSettings(profileId)
        .then((settings) => {
          if (!cancelled) {
            setFriendSettings(settings);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setFriendSettings(null);
          }
          if (__DEV__) {
            console.warn('[UserProfileScreen] fetchFriendSettings failed', error);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [friendStatus, isCurrentUser, profileId]),
  );

  const profile = remoteProfile ?? fallbackProfile;
  const profileMetaItems = getProfileMetaItems(profile);
  const displayName =
    remarkOverride === undefined
      ? friendSettings?.remark?.trim() || profile.remarkHint || profile.name
      : remarkOverride.remark ?? remarkOverride.fallbackName ?? profile.name;
  const tagValue = friendSettings?.assignedTags.length
    ? friendSettings.assignedTags.map((tag) => tag.name).join('、')
    : t('profileFields.notSet');
  const remarkValue =
    remarkOverride === undefined
      ? friendSettings?.remark?.trim() || t('profileFields.notSet')
      : remarkOverride.remark ?? t('profileFields.notSet');
  const descriptionValue = friendSettings?.description?.trim() ?? '';
  const photoNotes = friendSettings?.photos ?? [];
  const permissionValue = t(
    `userProfile.permissionValues.${friendSettings?.permission ?? 'FULL'}`,
  );
  const infoRows = isCurrentUser
    ? SELF_INFO_ROW_IDS
    : friendStatus === 'ACCEPTED'
      ? // The description row is noise when the viewer never wrote one, so drop it.
        INFO_ROW_IDS.filter((id) => id !== 'description' || descriptionValue)
      : NON_FRIEND_INFO_ROW_IDS;
  const showProfileActions = !isCurrentUser;
  const canSendFriendRequest = canOpenSendFriendRequest({
    isCurrentUser,
    profileId,
    friendStatus,
    hasProfileLoadError: fetchError !== null,
    hasFriendStatusLoadError: friendStatusLoadError,
  });
  const showAddFriendButton = canSendFriendRequest;
  const likeCount = Math.max(0, profile.likeCount ?? 0);

  const handleAddFriend = useCallback(() => {
    if (!canSendFriendRequest || profileId === 'unknown') {
      return;
    }

    router.push(getSendFriendRequestHref(scope, profileId, profile.name));
  }, [canSendFriendRequest, profile.name, profileId, router, scope]);

  const handleEditRemark = useCallback(() => {
    if (friendStatus !== 'ACCEPTED' || profileId === 'unknown') {
      return;
    }

    router.push(getEditFriendRemarkHref(scope, profileId, displayName, profile.name));
  }, [displayName, friendStatus, profile.name, profileId, router, scope]);

  const handleEditTags = useCallback(() => {
    if (friendStatus !== 'ACCEPTED' || profileId === 'unknown') {
      return;
    }

    router.push(getEditFriendTagsHref(scope, profileId, profile.name));
  }, [friendStatus, profile.name, profileId, router, scope]);

  const handleOpenMoments = useCallback(() => {
    if (profileId === 'unknown') {
      return;
    }

    router.push(getUserMomentsHref(scope, profileId, profile.name));
  }, [profile.name, profileId, router, scope]);

  const handleOpenChat = useCallback(async () => {
    if (profileId === 'unknown' || openingChat) {
      return;
    }

    try {
      setOpeningChat(true);
      const conversation = await getOrCreateSingleConversation(profileId);
      if (!mountedRef.current) return;
      router.push(
        getChatDetailHref(
          scope,
          profileId,
          displayName,
          profile.avatarUrl,
          conversation.conversationID,
        ),
      );
    } catch (error) {
      if (!mountedRef.current) return;
      if (shouldOpenChatPreview(error)) {
        router.push(
          getChatDetailHref(scope, profileId, displayName, profile.avatarUrl),
        );
        return;
      }

      Alert.alert(
        t('userProfile.openChatFailedTitle'),
        error instanceof Error ? error.message : t('common.networkError'),
      );
    } finally {
      if (mountedRef.current) setOpeningChat(false);
    }
  }, [displayName, openingChat, profile.avatarUrl, profileId, router, scope, t]);

  const handleOpenChatInfo = useCallback(() => {
    if (
      isCurrentUser ||
      profileId === 'unknown' ||
      friendStatus !== 'ACCEPTED'
    ) {
      return;
    }

    router.push(getChatInfoHref(scope, profileId, displayName, undefined, profile.name));
  }, [displayName, friendStatus, isCurrentUser, profile.name, profileId, router, scope]);
  const canOpenChatInfo =
    !isCurrentUser && profileId !== 'unknown' && friendStatus === 'ACCEPTED';

  const infoRowItems = useMemo<InfoRowItem[]>(
    () =>
      infoRows.map((id) => {
        const base: InfoRowItem = {
          id,
          label: t(`profile.${id}`),
          icon: ROW_ICON[id],
          iconColor: colors[ROW_COLOR[id]],
        };

        if (id === 'setRemark') {
          return { ...base, value: remarkValue, onPress: handleEditRemark };
        }

        if (id === 'tags') {
          return { ...base, value: tagValue, onPress: handleEditTags };
        }

        if (id === 'description') {
          return { ...base, value: descriptionValue };
        }

        if (id === 'permission') {
          return { ...base, value: permissionValue };
        }

        if (id === 'moments') {
          return { ...base, onPress: handleOpenMoments };
        }

        if (id === 'moreInfo' && canOpenChatInfo) {
          return { ...base, onPress: handleOpenChatInfo };
        }

        return base;
      }),
    [
      canOpenChatInfo,
      colors,
      descriptionValue,
      handleEditRemark,
      handleEditTags,
      handleOpenChatInfo,
      handleOpenMoments,
      infoRows,
      permissionValue,
      remarkValue,
      t,
      tagValue,
    ],
  );

  const infoRowGroups = useMemo(() => {
    const itemById = new Map(
      infoRowItems.map((item) => [item.id, item] as const),
    );
    return INFO_ROW_GROUPS.map((group) =>
      group
        .map((id) => itemById.get(id))
        .filter((item): item is InfoRowItem => item !== undefined),
    ).filter((group) => group.length > 0);
  }, [infoRowItems]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + 24,
      },
      avatarRing: {
        backgroundColor: colors.surface,
        borderColor: colors.primaryLight,
      },
      avatarFrame: {
        backgroundColor: colors.surface,
      },
      avatarFallback: {
        color: colors.white,
        fontSize: 32,
        fontWeight: '700' as const,
      },
      name: {
        color: colors.text,
        ...Typography.h1,
      },
      badge: {
        backgroundColor: colors.primary,
      },
      badgeText: {
        color: colors.white,
        ...Typography.tiny,
        fontWeight: '700' as const,
      },
      account: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      metaChip: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      metaChipText: {
        color: colors.textSecondary,
        ...Typography.small,
        fontWeight: '600' as const,
      },
      signature: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        lineHeight: 20,
      },
      recognitionPill: {
        backgroundColor: colors.surface,
        borderColor: colors.primaryLight,
      },
      recognitionText: {
        color: colors.primary,
        ...Typography.caption,
        fontWeight: '700' as const,
      },
      card: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      rowDivider: {
        backgroundColor: colors.surfaceBorder,
      },
      photoNotesTitle: {
        color: colors.textSecondary,
      },
      photoNote: {
        backgroundColor: colors.background,
      },
      actionText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      actionButton: {
        backgroundColor: colors.primary,
      },
      actionButtonPressed: {
        opacity: 0.85,
      },
      addButton: {
        backgroundColor: colors.primary,
      },
      addButtonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      addButtonDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
    }),
    [colors, insets.bottom],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('userProfile.title')}
        rightSlot={
          <View
            style={[s.recognitionPill, d.recognitionPill]}
            accessibilityLabel={t('userProfile.likesReceived', {
              count: likeCount,
              defaultValue: `获赞 ${likeCount}`,
            })}
          >
            <Image
              source={RECOGNITION_COUNT_ICON_SOURCE}
              style={s.recognitionIconImage}
              contentFit="contain"
              tintColor={colors.primary}
            />
            <Text style={d.recognitionText}>{likeCount}</Text>
          </View>
        }
      />
      {fetchError ? (
        <Text style={{ color: colors.error, textAlign: 'center', paddingVertical: 6, ...Typography.small }}>
          {fetchError}
        </Text>
      ) : null}
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.hero}>
          <View style={[s.avatarRing, d.avatarRing]}>
            <View style={[s.avatarFrame, d.avatarFrame]}>
              {profile.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={s.avatarImage} />
              ) : (
                <Text style={d.avatarFallback}>{profile.name.charAt(0)}</Text>
              )}
            </View>
          </View>

          <View style={s.identity}>
            <View style={s.nameRow}>
              <Text style={d.name}>{displayName}</Text>
              <View style={[s.badge, d.badge]}>
                <Text style={d.badgeText}>{profile.memberLabel}</Text>
              </View>
            </View>
            <Text style={d.account}>{t('contacts.accountId', { id: profile.accountId })}</Text>
          </View>

          {profileMetaItems.length > 0 ? (
            <View style={s.metaRow}>
              {profileMetaItems.map((item, index) => (
                <View key={`${item}-${index}`} style={[s.metaChip, d.metaChip]}>
                  <Ionicons
                    name={
                      index === 0
                        ? item === t('profileFields.female')
                          ? 'female-outline'
                          : item === t('profileFields.male')
                            ? 'male-outline'
                            : 'person-outline'
                        : 'location-outline'
                    }
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text style={d.metaChipText}>{item}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {profile.signature ? (
            <Text style={[s.signature, d.signature]} numberOfLines={2}>
              {profile.signature}
            </Text>
          ) : null}

          {(profile.displayIcons?.length ?? 0) > 0 ? (
            <View style={s.badgeIconRow}>
              <UserIconRow icons={profile.displayIcons ?? []} />
            </View>
          ) : null}
        </View>

        {infoRowGroups.length > 0 ? (
          <View style={s.sections}>
            {infoRowGroups.map((group, groupIndex) => (
              <View key={`info-group-${groupIndex}`} style={[s.card, d.card]}>
                {group.map((item, index) => (
                  <View key={item.id}>
                    <ProfileActionRow
                      icon={item.icon}
                      iconColor={item.iconColor}
                      label={item.label}
                      value={item.value}
                      onPress={item.onPress}
                    />
                    {index < group.length - 1 ? (
                      <View style={[s.rowDivider, d.rowDivider]} />
                    ) : null}
                  </View>
                ))}
              </View>
            ))}

            {!isCurrentUser && friendStatus === 'ACCEPTED' && photoNotes.length > 0 ? (
              <View style={[s.card, d.card]}>
                <Text style={[s.photoNotesTitle, d.photoNotesTitle]}>
                  {t('userProfile.photoNotesTitle')}
                </Text>
                <View style={s.photoNotesStrip}>
                  {photoNotes.map((uri) => (
                    <Image
                      key={uri}
                      source={{ uri }}
                      style={[s.photoNote, d.photoNote]}
                      contentFit="cover"
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {showProfileActions ? (
          <View style={s.actionSection}>
            <Pressable
              style={({ pressed }) => [
                s.actionButton,
                d.actionButton,
                pressed && d.actionButtonPressed,
              ]}
              onPress={() => {
                void handleOpenChat();
              }}
              disabled={openingChat}
            >
              <Text style={d.actionText}>
                {openingChat ? t('userProfile.openingChat') : t('userProfile.startChat')}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                s.actionButton,
                d.actionButton,
                pressed && d.actionButtonPressed,
              ]}
              // 之前没 onPress，纯哑按钮。RTC SDK 还没接入（同 chat-detail 视频按钮 → #28），
              // 至少弹个 stopgap 别让用户以为没响应。
              onPress={() =>
                Alert.alert(
                  t('userProfile.avCall'),
                  t('userProfile.avCallComingSoon', {
                    defaultValue: '音视频通话功能即将上线，敬请期待。',
                  }),
                )
              }
            >
              <Text style={d.actionText}>{t('userProfile.avCall')}</Text>
            </Pressable>
            {showAddFriendButton ? (
              <Pressable
                style={({ pressed }) => [
                  s.actionButton,
                  d.addButton,
                  pressed && d.actionButtonPressed,
                ]}
                onPress={handleAddFriend}
              >
                <Text style={d.addButtonText}>{t('userProfile.addFriendRequest')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
