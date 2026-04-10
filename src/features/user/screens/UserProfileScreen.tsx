import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { getOrCreateSingleConversation } from '@/im/client';
import { getProfileSignature } from '@/features/profile/profile-display';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { ProfileActionRow } from '@/features/user/components/profile-action-row';
import {
  getUserProfileById,
  type UserProfileData,
} from '@/features/user/data/profiles';
import {
  canOpenSendFriendRequest,
  getProfileMetaItems,
  isCurrentUserProfile,
} from '@/features/user/profile-view';
import {
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

const INFO_ROWS = [
  '朋友圈',
  '设置备注',
  '标签',
  '给该用户赠送金币',
  '更多信息',
] as const;
const NON_FRIEND_INFO_ROWS = ['朋友圈', '给该用户赠送金币', '更多信息'] as const;
const SELF_INFO_ROWS = ['朋友圈'] as const;

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
  const fallbackProfile = getUserProfileById(
    profileId,
    typeof params.name === 'string' ? params.name : undefined,
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
        memberLabel: currentUser.role === 'ADMIN' ? '管理员' : '普通用户',
        badges: [currentUser.role === 'ADMIN' ? '管理员' : '普通用户'],
        gender: currentUser.gender,
        city: currentUser.city,
        signature: getProfileSignature(
          currentUser.persona,
          currentUser.helloWords,
        ),
        phone: currentUser.phoneNumber ?? '未公开',
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
          memberLabel: profile.role === 'ADMIN' ? '管理员' : '普通用户',
          badges: [profile.role === 'ADMIN' ? '管理员' : '普通用户'],
          gender: profile.gender,
          city: profile.city,
          signature: getProfileSignature(profile.persona, profile.helloWords),
          phone: profile.phoneNumber ?? '未公开',
          remarkHint: profile.nickname,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteProfile(null);
          setFetchError('加载用户资料失败，显示缓存数据');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser, isCurrentUser, profileId]);

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
        .catch(() => {
          if (!cancelled) {
            setFriendStatusLoadError(true);
            setFriendStatus(null);
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
        .catch(() => {
          if (!cancelled) {
            setFriendSettings(null);
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
    : '未设置';
  const remarkValue = friendSettings?.remark?.trim() || '未设置';
  const infoRows = isCurrentUser
    ? SELF_INFO_ROWS
    : friendStatus === 'ACCEPTED'
      ? INFO_ROWS
      : NON_FRIEND_INFO_ROWS;
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
          profileId,
          displayName,
          profile.avatarUrl,
          conversation.conversationID,
        ),
      );
    } catch (error) {
      Alert.alert(
        '暂时无法打开聊天',
        error instanceof Error ? error.message : '请稍后重试',
      );
    } finally {
      setOpeningChat(false);
    }
  }, [displayName, openingChat, profile.avatarUrl, profileId, router]);

  const infoRowItems = useMemo(
    () =>
      infoRows.map((label) => {
        if (label === '设置备注') {
          return {
            label,
            value: remarkValue,
            onPress: handleEditRemark,
          };
        }

        if (label === '标签') {
          return {
            label,
            value: tagValue,
            onPress: handleEditTags,
          };
        }

        return { label };
      }),
    [handleEditRemark, handleEditTags, infoRows, remarkValue, tagValue],
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
      <NavHeader title="个人信息" rightIcon="ellipsis-horizontal" />
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
            <Text style={d.account}>账号：{profile.accountId}</Text>
            <View style={s.metaRow}>
              {profileMetaItems.map((item, index) => (
                <View key={`${item}-${index}`} style={[s.metaChip, d.metaChip]}>
                  <Ionicons
                    name={
                      index === 0
                        ? item === '女'
                          ? 'female-outline'
                          : item === '男'
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
              {profile.badges.map((badge, index) => (
                <View key={`${badge}-${index}`} style={[s.badgeIcon, d.badgeIcon]}>
                  <Text style={d.badgeIconText}>{badge.slice(0, 1)}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={s.listSection}>
          <Divider />
          {infoRowItems.map((item, index) => (
            <View key={item.label}>
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
                {openingChat ? '正在打开聊天...' : '发起聊天'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                s.actionButton,
                d.actionButton,
                pressed && d.actionButtonPressed,
              ]}
            >
              <Text style={d.actionText}>音视频通话</Text>
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
            <Text style={d.addButtonText}>发好友申请</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
