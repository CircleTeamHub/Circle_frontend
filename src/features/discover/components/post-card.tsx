import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Radius, Typography } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { Post } from '@/types';

interface PostCardProps {
  post: Post;
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerText: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: 180,
    borderRadius: Radius.md,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});

export const PostCard: React.FC<PostCardProps> = ({ post }) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      card: {
        backgroundColor: colors.surface,
        borderRadius: Radius.lg,
        padding: Spacing.md,
        gap: Spacing.md - 4,
      },
      authorName: {
        color: colors.text,
        fontSize: 14,
        fontWeight: '600' as const,
      },
      badgeTime: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      body: {
        color: colors.text,
        fontSize: 14,
        lineHeight: 21,
      },
      imageBg: {
        backgroundColor: colors.surface,
      },
      actionCount: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
    }),
    [colors],
  );

  return (
    <View style={d.card}>
      {/* Header */}
      <View style={s.header}>
        <Avatar size={36} name={post.author} />
        <View style={s.headerText}>
          <Text style={d.authorName}>{post.author}</Text>
          <Text style={d.badgeTime}>
            {post.badge} · {post.time}
          </Text>
        </View>
      </View>

      {/* Body */}
      <Text style={d.body}>{post.content}</Text>

      {/* Image */}
      {post.imageUrl ? (
        <Image
          source={{ uri: post.imageUrl }}
          style={[s.image, d.imageBg]}
          contentFit="cover"
        />
      ) : null}

      {/* Actions */}
      <View style={s.actions}>
        <View style={s.actionsLeft}>
          <Pressable style={s.actionBtn}>
            <Ionicons name="heart-outline" size={18} color={colors.textSecondary} />
            <Text style={d.actionCount}>{post.likes}</Text>
          </Pressable>
          <Pressable style={s.actionBtn}>
            <Ionicons
              name="chatbubble-outline"
              size={18}
              color={colors.textSecondary}
            />
            <Text style={d.actionCount}>{post.comments}</Text>
          </Pressable>
        </View>
        <Pressable>
          <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
};
