import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { useTheme } from '@/theme';
import type { ChatTarget } from './types';

interface ChatTargetAvatarProps {
  target: ChatTarget;
  size: number;
}

export function ChatTargetAvatar({ target, size }: ChatTargetAvatarProps) {
  const { colors } = useTheme();
  if (target.kind === 'direct') {
    return <Avatar size={size} shape="square" name={target.name} uri={target.avatarUrl} />;
  }
  return (
    <GroupChatAvatar
      size={size}
      name={target.name}
      uri={target.avatarUrl}
      temporary={target.kind === 'temp'}
      badgeBorderColor={colors.surface}
    />
  );
}
