import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { Spacing, Typography, useTheme } from '@/theme';
import type { Conversation } from '@/types';

interface GroupMemberRowProps {
  conversation: Conversation;
  checked: boolean;
  disabled: boolean;
  onToggle: (conversationId: string) => void;
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  meta: { flex: 1, gap: 2 },
  name: { ...Typography.body, fontWeight: '600' },
  subtitle: { ...Typography.small },
});

export const GroupMemberRow = memo(function GroupMemberRow({
  conversation,
  checked,
  disabled,
  onToggle,
}: GroupMemberRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({ name: { color: colors.text }, subtitle: { color: colors.textSecondary } }),
    [colors],
  );
  const isGroup = conversation.conversationType === 'group';

  return (
    <Pressable
      style={s.row}
      onPress={() => onToggle(conversation.id)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
    >
      {isGroup ? (
        <GroupChatAvatar
          size={36}
          name={conversation.name}
          uri={conversation.avatarUrl}
          temporary={conversation.isTempChat}
          badgeBorderColor={colors.background}
        />
      ) : (
        <Avatar size={36} name={conversation.name} uri={conversation.avatarUrl} />
      )}
      <View style={s.meta}>
        <Text style={[s.name, d.name]} numberOfLines={1}>
          {conversation.name}
        </Text>
        <Text style={[s.subtitle, d.subtitle]} numberOfLines={1}>
          {isGroup
            ? t('messages.groups.groupChat', { defaultValue: '群聊' })
            : t('messages.groups.directChat', { defaultValue: '私聊' })}
        </Text>
      </View>
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={22}
        color={checked ? colors.iconAccent : colors.textSecondary}
      />
    </Pressable>
  );
});
