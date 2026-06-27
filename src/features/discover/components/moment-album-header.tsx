import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { Avatar } from '@/components/ui/avatar';
import { GradientCover } from '@/components/ui/gradient-cover';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const COVER_HEIGHT = 260;
const AVATAR_SIZE = 76;
const COVER_IMAGE_SCALE = 1.04;
const AVATAR_DOWN_OFFSET = 20;
const COVER_OVERLAP_EXTENSION = AVATAR_DOWN_OFFSET;
const COVER_VISIBLE_HEIGHT = COVER_HEIGHT + COVER_OVERLAP_EXTENSION;
const SIGNATURE_GAP = 6;
const SIGNATURE_HEIGHT = 18;

interface MomentAlbumHeaderProps {
  coverUrl?: string | null;
  avatarUrl?: string | null;
  nickname: string;
  signature?: string | null;
  /** 传入则封面可点（仅自己的相册），点按触发更换封面。 */
  onPressCover?: () => void;
  /** FlatList 的滚动偏移；下拉（负值）时封面从顶部往下拉伸（微信效果）。 */
  scrollY?: SharedValue<number>;
}

const s = StyleSheet.create({
  container: {
    height:
      COVER_HEIGHT +
      AVATAR_SIZE / 2 +
      AVATAR_DOWN_OFFSET +
      SIGNATURE_GAP +
      SIGNATURE_HEIGHT,
  },
  // 从顶边开始缩放，向下拉伸填充下拉露出的空间
  coverWrap: {
    height: COVER_VISIBLE_HEIGHT,
    overflow: 'hidden',
    transformOrigin: 'top',
  },
  cover: {
    width: '100%',
    height: COVER_VISIBLE_HEIGHT,
  },
  coverImage: {
    transform: [{ scale: COVER_IMAGE_SCALE }],
  },
  identityRow: {
    position: 'absolute',
    top: COVER_HEIGHT - AVATAR_SIZE / 2,
    right: Spacing.lg,
    flexDirection: 'row',
    // 顶对齐让昵称落在封面图之上，而不是下沿的白色区域
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  nickname: {
    ...Typography.h3,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  avatarColumn: {
    marginTop: AVATAR_DOWN_OFFSET,
    alignItems: 'center',
    gap: SIGNATURE_GAP,
    maxWidth: 128,
  },
  avatarWrap: {
    // 圆角与方形头像一致（Avatar shape="square" 用 Radius.sm），避免方框套圆形露角
    borderRadius: Radius.sm,
    borderWidth: 2,
    overflow: 'hidden',
  },
  signature: {
    ...Typography.small,
    height: SIGNATURE_HEIGHT,
    maxWidth: 128,
    textAlign: 'center',
  },
});

export const MomentAlbumHeader: React.FC<MomentAlbumHeaderProps> = ({
  coverUrl,
  avatarUrl,
  nickname,
  signature,
  onPressCover,
  scrollY,
}) => {
  const { colors } = useTheme();
  const trimmedSignature = signature?.trim();

  const d = useMemo(
    () => ({
      nickname: {
        color: colors.white,
        textShadowColor: colors.black,
      },
      avatarWrap: { borderColor: colors.white },
      signature: { color: colors.textSecondary },
    }),
    [colors],
  );

  // 下拉（scrollY < 0）时：上移抵消内容下移把封面顶边钉在屏幕顶，再从顶部放大铺满。
  const coverAnimatedStyle = useAnimatedStyle(() => {
    const offset = scrollY ? scrollY.value : 0;
    const pull = offset < 0 ? -offset : 0;
    return {
      transform: [
        { translateY: -pull },
        { scale: 1 + pull / COVER_VISIBLE_HEIGHT },
      ],
    };
  });

  const coverContent = coverUrl ? (
    <Image
      source={{ uri: coverUrl }}
      style={[s.cover, s.coverImage]}
      contentFit="cover"
    />
  ) : (
    <View style={[s.cover, s.coverImage]}>
      <GradientCover />
    </View>
  );

  return (
    <View style={s.container}>
      <Animated.View style={[s.coverWrap, coverAnimatedStyle]}>
        {onPressCover ? (
          <Pressable onPress={onPressCover}>{coverContent}</Pressable>
        ) : (
          coverContent
        )}
      </Animated.View>

      <View style={s.identityRow}>
        <Text style={[s.nickname, d.nickname]} numberOfLines={1}>
          {nickname}
        </Text>
        <View style={s.avatarColumn}>
          <View style={[s.avatarWrap, d.avatarWrap]}>
            <Avatar
              size={AVATAR_SIZE}
              name={nickname}
              uri={avatarUrl ?? undefined}
              shape="square"
            />
          </View>
          {trimmedSignature ? (
            <Text style={[s.signature, d.signature]} numberOfLines={1}>
              {trimmedSignature}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
};
