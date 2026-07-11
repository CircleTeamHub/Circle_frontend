import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { PlazaPostCard } from '@/features/discover/components/plaza-post-card';
import { fetchPlazaPost } from '@/services/api/plaza';
import { joinCircle } from '@/services/api/circles';
import { ApiError } from '@/services/api/client';
import { getApiErrorMessage } from '@/services/api/errors';
import type { CirclePlazaPost } from '@/types';

// 后端「非本圈成员」错误(PLAZA_NOT_CIRCLE_MEMBER)把主圈子信息放进 data，供「申请加入」。
interface RestrictedInfo {
  circleId: string;
  circleName: string;
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.lg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  restrictedText: { textAlign: 'center' },
  joinBtn: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function PlazaPostDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [post, setPost] = useState<CirclePlazaPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState<RestrictedInfo | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setRestricted(null);
    let cancelled = false;
    fetchPlazaPost(id)
      .then((data) => {
        if (!cancelled) setPost(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setPost(null);
        // 非本圈成员：帖子存在但不可见，展示「申请加入圈子」而非「帖子不存在」。
        if (
          err instanceof ApiError &&
          err.errorCode === 'PLAZA_NOT_CIRCLE_MEMBER'
        ) {
          const info = (err.data ?? {}) as Partial<RestrictedInfo>;
          if (info.circleId) {
            setRestricted({
              circleId: info.circleId,
              circleName: info.circleName ?? '',
            });
            return;
          }
        }
        setError(
          err instanceof ApiError && err.status === 404
            ? t('plaza.postDetail.notExist', {
                defaultValue: '帖子不存在或已结束',
              })
            : getApiErrorMessage(
                err,
                t('plaza.postDetail.loadFailed', {
                  defaultValue: '加载失败，请稍后重试',
                }),
              ),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  const handleJoin = useCallback(async () => {
    if (!restricted || joining) return;
    setJoining(true);
    try {
      await joinCircle(restricted.circleId);
      Alert.alert(
        t('plaza.postDetail.joinSubmittedTitle', { defaultValue: '已提交申请' }),
        t('plaza.postDetail.joinSubmittedMessage', {
          defaultValue: '加入申请已提交，通过后即可查看活动',
        }),
      );
    } catch (err) {
      Alert.alert(
        t('plaza.postDetail.joinFailedTitle', { defaultValue: '申请失败' }),
        getApiErrorMessage(
          err,
          t('plaza.postDetail.joinFailedMessage', {
            defaultValue: '请稍后重试',
          }),
        ),
      );
    } finally {
      setJoining(false);
    }
  }, [restricted, joining, t]);

  return (
    <View
      style={[
        s.container,
        { paddingTop: insets.top, backgroundColor: colors.background },
      ]}
    >
      <NavHeader title={t('plaza.postDetail.title', { defaultValue: '活动详情' })} />
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : post ? (
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <PlazaPostCard post={post} />
        </ScrollView>
      ) : restricted ? (
        <View style={s.center}>
          <Ionicons
            name="lock-closed-outline"
            size={40}
            color={colors.textSecondary}
          />
          <Text style={[Typography.h3, { color: colors.text }]}>
            {t('plaza.postDetail.notMemberTitle', { defaultValue: '无法查看' })}
          </Text>
          <Text
            style={[
              Typography.body,
              s.restrictedText,
              { color: colors.textSecondary },
            ]}
          >
            {restricted.circleName
              ? t('plaza.postDetail.notMemberNamed', {
                  circle: restricted.circleName,
                  defaultValue: '你不是「{{circle}}」的成员，加入后即可查看活动',
                })
              : t('plaza.postDetail.notMember', {
                  defaultValue: '你不是本圈子成员，无法查看',
                })}
          </Text>
          <Pressable
            style={[
              s.joinBtn,
              { backgroundColor: colors.primary, opacity: joining ? 0.6 : 1 },
            ]}
            onPress={handleJoin}
            disabled={joining}
            accessibilityRole="button"
          >
            {joining ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text
                style={[
                  Typography.body,
                  { color: colors.white, fontWeight: '700' },
                ]}
              >
                {t('plaza.postDetail.joinCircle', {
                  defaultValue: '申请加入圈子',
                })}
              </Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={s.center}>
          <Text
            style={[
              Typography.body,
              s.restrictedText,
              { color: colors.textSecondary },
            ]}
          >
            {error ??
              t('plaza.postDetail.notExist', {
                defaultValue: '帖子不存在或已结束',
              })}
          </Text>
        </View>
      )}
    </View>
  );
}
