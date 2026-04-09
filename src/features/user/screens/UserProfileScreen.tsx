import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { getProfileSignature } from '@/features/profile/profile-display';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { ProfileActionRow } from '@/features/user/components/profile-action-row';
import {
  getUserProfileById,
  type UserProfileData,
} from '@/features/user/data/profiles';
import {
  getProfileMetaItems,
  isCurrentUserProfile,
} from '@/features/user/profile-view';
import { fetchUserProfile } from '@/services/api/profile';
import { useAuthStore } from '@/stores/authStore';

const INFO_ROWS = [
  '朋友圈',
  '设置备注',
  '标签',
  '给该用户赠送金币',
  '更多信息',
] as const;

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
    borderTopWidth: 1,
    marginTop: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'center',
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
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const currentUser = useAuthStore((state) => state.user);
  const [remoteProfile, setRemoteProfile] = useState<UserProfileData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const profileId =
    typeof params.id === 'string' ? params.id : 'unknown';
  const isCurrentUser = isCurrentUserProfile(profileId, currentUser);
  const showAddFriendButton = !isCurrentUser;
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

  const profile = remoteProfile ?? fallbackProfile;
  const profileMetaItems = getProfileMetaItems(profile);

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
      actionSection: {
        borderTopColor: colors.divider,
      },
      actionText: {
        color: colors.primary,
        ...Typography.body,
        fontWeight: '600' as const,
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
              <Text style={d.name}>{profile.remarkHint ?? profile.name}</Text>
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
          {INFO_ROWS.map((label, index) => (
            <View key={label}>
              <ProfileActionRow label={label} />
              {index < INFO_ROWS.length - 1 ? <Divider /> : null}
            </View>
          ))}
          <Divider />
        </View>

        <View style={[s.actionSection, d.actionSection]}>
          <Pressable>
            <Text style={d.actionText}>发起聊天</Text>
          </Pressable>
          <Pressable>
            <Text style={d.actionText}>音视频通话</Text>
          </Pressable>
        </View>
      </ScrollView>

      {showAddFriendButton ? (
        <View style={d.footer}>
          <Pressable style={[s.addButton, d.addButton]}>
            <Text style={d.addButtonText}>添加好友</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
