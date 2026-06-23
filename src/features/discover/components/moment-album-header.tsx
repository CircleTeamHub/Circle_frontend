import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Avatar } from '@/components/ui/avatar';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const COVER_HEIGHT = 260;
const AVATAR_SIZE = 64;

interface MomentAlbumHeaderProps {
  coverUrl?: string | null;
  avatarUrl?: string | null;
  nickname: string;
  /** 传入则封面可点（仅自己的相册），点按触发更换封面。 */
  onPressCover?: () => void;
}

const s = StyleSheet.create({
  container: {
    height: COVER_HEIGHT + AVATAR_SIZE / 2,
  },
  cover: {
    width: '100%',
    height: COVER_HEIGHT,
  },
  identityRow: {
    position: 'absolute',
    top: COVER_HEIGHT - AVATAR_SIZE / 2,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  nickname: {
    ...Typography.h3,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  avatarWrap: {
    borderRadius: Radius.md,
    borderWidth: 2,
    overflow: 'hidden',
  },
});

export const MomentAlbumHeader: React.FC<MomentAlbumHeaderProps> = ({
  coverUrl,
  avatarUrl,
  nickname,
  onPressCover,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      coverPlaceholder: { backgroundColor: colors.surface },
      nickname: {
        color: colors.white,
        textShadowColor: colors.overlay,
      },
      avatarWrap: { borderColor: colors.white },
    }),
    [colors],
  );

  const coverContent = coverUrl ? (
    <Image source={{ uri: coverUrl }} style={s.cover} contentFit="cover" />
  ) : (
    <View style={[s.cover, d.coverPlaceholder]} />
  );

  return (
    <View style={s.container}>
      {onPressCover ? (
        <Pressable onPress={onPressCover}>{coverContent}</Pressable>
      ) : (
        coverContent
      )}

      <View style={s.identityRow}>
        <Text style={[s.nickname, d.nickname]} numberOfLines={1}>
          {nickname}
        </Text>
        <View style={[s.avatarWrap, d.avatarWrap]}>
          <Avatar
            size={AVATAR_SIZE}
            name={nickname}
            uri={avatarUrl ?? undefined}
          />
        </View>
      </View>
    </View>
  );
};
