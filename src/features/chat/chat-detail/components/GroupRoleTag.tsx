import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChatGroupManagerDto } from '@/chat-core/protocol';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface GroupRoleTagProps {
  role: ChatGroupManagerDto['role'];
}

const s = StyleSheet.create({
  tag: {
    ...Typography.tiny,
    lineHeight: 16,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.xs,
    overflow: 'hidden',
  },
});

/** 群聊发送者名字前的【群主】【管理员】小标签:群主橙、管理员主题紫。 */
export const GroupRoleTag: React.FC<GroupRoleTagProps> = ({ role }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tone = useMemo(
    () =>
      role === 'OWNER'
        ? { backgroundColor: colors.groupOwnerTagBg, color: colors.warningText }
        : { backgroundColor: colors.primaryLight, color: colors.primary },
    [colors, role],
  );
  return (
    <Text style={[s.tag, tone]}>
      {role === 'OWNER' ? t('chat.groupOwner') : t('chat.groupAdmin')}
    </Text>
  );
};
