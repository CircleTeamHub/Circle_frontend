import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Radius, Typography } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { Post } from '@/types';

interface PostCardProps {
  post: Post;
}

export const PostCard: React.FC<PostCardProps> = ({ post }) => {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.surface,
          borderRadius: Radius.lg,
          padding: Spacing.md,
          gap: Spacing.md - 4,
        },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        },
        headerText: {
          flex: 1,
        },
        authorName: {
          color: colors.text,
          fontSize: 14,
          fontWeight: '600',
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
        image: {
          width: '100%',
          height: 180,
          borderRadius: Radius.md,
          backgroundColor: colors.surface,
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
        actionCount: {
          color: colors.textSecondary,
          ...Typography.caption,
        },
      }),
    [colors],
  );

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <Avatar size={36} name={post.author} />
        <View style={styles.headerText}>
          <Text style={styles.authorName}>{post.author}</Text>
          <Text style={styles.badgeTime}>
            {post.badge} · {post.time}
          </Text>
        </View>
      </View>

      {/* Body */}
      <Text style={styles.body}>{post.content}</Text>

      {/* Image */}
      {post.imageUrl ? (
        <Image
          source={{ uri: post.imageUrl }}
          style={styles.image}
          contentFit="cover"
        />
      ) : null}

      {/* Actions */}
      <View style={styles.actions}>
        <View style={styles.actionsLeft}>
          <Pressable style={styles.actionBtn}>
            <Ionicons name="heart-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.actionCount}>{post.likes}</Text>
          </Pressable>
          <Pressable style={styles.actionBtn}>
            <Ionicons
              name="chatbubble-outline"
              size={18}
              color={colors.textSecondary}
            />
            <Text style={styles.actionCount}>{post.comments}</Text>
          </Pressable>
        </View>
        <Pressable>
          <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
};
