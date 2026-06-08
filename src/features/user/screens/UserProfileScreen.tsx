import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { UserIconRow } from '@/components/ui/user-icon-row';
import { shouldOpenChatPreview } from '@/features/chat/chat-preview';
import { getOrCreateSingleConversation } from '@/im/client';
import { getProfileSignature } from '@/features/profile/profile-display';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { ProfileActionRow } from '@/features/user/components/profile-action-row';
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

const INFO_ROW_IDS = ['moments', 'setRemark', 'tags', 'giftCoins', 'moreInfo'] as const;
const NON_FRIEND_INFO_ROW_IDS = ['moments', 'giftCoins', 'moreInfo'] as const;
const SELF_INFO_ROW_IDS = ['moments'] as const;

const s = StyleSheet.create({
  headerBlock: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    alignItems: 'flex-start',
  },
  avatarFrame: {
    width: 68,
    height: 68,
    borderRadius: Radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  info: {
    flex: 1,
    gap: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaChip: {
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeIconRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    minHeight: 36,
    alignItems: 'center',
  },
  badgeIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listSection: {
    marginTop: Spacing.md,
  },
  actionSection: {
    marginTop: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'center',
  },
  actionButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
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

  const profileId =
    typeof params.id === 'string' ? params.id : 'unknown';
  const scope = getUserProfileScopeFromSegments(segments);
  const isCurrentUser = isCurrentUserProfile(profileId, currentUser);
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
    }),
    [fallbackName, profileId, t],
  );

  useEffect(() => {
    let cancelled = false;

    setFetchError(null);

    // params 中没有 id 时 profileId 为 'unknown'，跳过请求，使用 fallback 静态数据
    if (profileId === 'unknown') {
      return;
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
        phone: currentUser.phoneNumber ?? t('userProfile.phoneHidden'),
        remarkHint: currentUser.nickname,
      });
      return;
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
  }, [currentUser, isCurrentUser, profileId, t]);

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
  const displayName = friendSettings?.remark?.trim() || profile.remarkHint || profile.name;
  const tagValue = friendSettings?.assignedTags.length
    ? friendSettings.assignedTags.map((tag) => tag.name).join('、')
    : t('profileFields.notSet');
  const remarkValue = friendSettings?.remark?.trim() || t('profileFields.notSet');
  const infoRows = isCurrentUser
    ? SELF_INFO_ROW_IDS
    : friendStatus === 'ACCEPTED'
      ? INFO_ROW_IDS
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

    router.push(getEditFriendRemarkHref(scope, profileId, profile.name));
  }, [friendStatus, profile.name, profileId, router, scope]);

  const handleEditTags = useCallback(() => {
    if (friendStatus !== 'ACCEPTED' || profileId === 'unknown') {
      return;
    }

    router.push(getEditFriendTagsHref(scope, profileId, profile.name));
  }, [friendStatus, profile.name, profileId, router, scope]);

  const handleOpenChat = useCallback(async () => {
    if (profileId === 'unknown' || openingChat) {
      return;
    }

    try {
      setOpeningChat(true);
      const conversation = await getOrCreateSingleConversation(profileId);
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
      setOpeningChat(false);
    }
  }, [displayName, openingChat, profile.avatarUrl, profileId, router, t]);

  const handleOpenChatInfo = useCallback(() => {
    if (
      isCurrentUser ||
      profileId === 'unknown' ||
      friendStatus !== 'ACCEPTED'
    ) {
      return;
    }

    router.push(getChatInfoHref(scope, profileId, displayName));
  }, [displayName, friendStatus, isCurrentUser, profileId, router, scope]);

  const infoRowItems = useMemo(
    () =>
      infoRows.map((id) => {
        const label = t(`profile.${id}`);

        if (id === 'setRemark') {
          return {
            id,
            label,
            value: remarkValue,
            onPress: handleEditRemark,
          };
        }

        if (id === 'tags') {
          return {
            id,
            label,
            value: tagValue,
            onPress: handleEditTags,
          };
        }

        return { id, label };
      }),
    [handleEditRemark, handleEditTags, infoRows, remarkValue, t, tagValue],
  );

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + (showAddFriendButton ? 104 : 32),
      },
      avatarFrame: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      avatarFallback: {
        color: colors.white,
        fontSize: 26,
        fontWeight: '700' as const,
      },
      name: {
        color: colors.text,
        fontSize: 22,
        fontWeight: '700' as const,
      },
      badge: {
        backgroundColor: colors.primaryLight,
      },
      badgeText: {
        color: colors.primary,
        ...Typography.tiny,
        fontWeight: '600' as const,
      },
      badgeIcon: {
        backgroundColor: colors.primaryLight,
      },
      badgeIconText: {
        color: colors.primary,
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
        ...Typography.tiny,
        fontWeight: '600' as const,
      },
      signature: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      actionText: {
        color: colors.primary,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      actionButton: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
        shadowColor: colors.black,
      },
      actionButtonPressed: {
        opacity: 0.9,
      },
      footer: {
        position: 'absolute' as const,
        left: Spacing.lg,
        right: Spacing.lg,
        bottom: insets.bottom + Spacing.md,
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
    [colors, insets.bottom, showAddFriendButton],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('userProfile.title')}
        rightIcon="settings-outline"
        onRightPress={handleOpenChatInfo}
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
        <View style={s.headerBlock}>
          <View style={[s.avatarFrame, d.avatarFrame]}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={s.avatarImage} />
            ) : (
              <Text style={d.avatarFallback}>
                {profile.name.charAt(0)}
              </Text>
            )}
          </View>
          <View style={s.info}>
            <View style={s.nameRow}>
              <Text style={d.name}>{displayName}</Text>
              <View style={[s.badge, d.badge]}>
                <Text style={d.badgeText}>{profile.memberLabel}</Text>
              </View>
            </View>
            <Text style={d.account}>{t('contacts.accountId', { id: profile.accountId })}</Text>
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
            <Text style={d.signature}>{profile.signature}</Text>
            <View style={s.badgeIconRow}>
              <UserIconRow icons={profile.displayIcons ?? []} />
            </View>
          </View>
        </View>

        <View style={s.listSection}>
          <Divider />
          {infoRowItems.map((item, index) => (
            <View key={item.id}>
              <ProfileActionRow
                label={item.label}
                value={item.value}
                onPress={item.onPress}
              />
              {index < infoRowItems.length - 1 ? <Divider /> : null}
            </View>
          ))}
          <Divider />
        </View>

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
          </View>
        ) : null}
      </ScrollView>

      {showAddFriendButton ? (
        <View style={d.footer}>
          <Pressable
            style={[
              s.addButton,
              d.addButton,
            ]}
            onPress={handleAddFriend}
          >
            <Text style={d.addButtonText}>{t('userProfile.addFriendRequest')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
