import { FlatList, Pressable, Text, View } from 'react-native';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import { Avatar } from '@/components/ui/avatar';
import { type ThemeColors } from '@/theme';
import { type TFunction } from 'i18next';
import {
  type ChatDetailThemedStyles,
} from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { type MentionTarget } from '@/features/chat/utils/chat-send-payloads';

export interface MentionPickerPanelProps {
  colors: ThemeColors;
  t: TFunction<"translation", undefined>;
  mentionPickerVisible: boolean;
  d: ChatDetailThemedStyles;
  visibleMentionCandidates: MentionTarget[];
  handlePickMention: (target: MentionTarget) => void;
}

/**
 * 群聊输入 @ 时弹出的成员候选列表。
 */
export function MentionPickerPanel({
  colors,
  t,
  mentionPickerVisible,
  d,
  visibleMentionCandidates,
  handlePickMention,
}: MentionPickerPanelProps) {
  return mentionPickerVisible ? (
    <View style={[s.mentionPicker, d.composerShell]}>
      <FlatList
        data={visibleMentionCandidates}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(member) => member.userID}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={4}
        renderItem={({ item: member }) => (
          <Pressable
            style={s.mentionRow}
            onPress={() => handlePickMention(member)}
          >
            <Avatar size={28} shape="square" name={member.nickname} />
            <Text
              style={[s.mentionName, { color: colors.text }]}
              numberOfLines={1}
            >
              {member.nickname}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={s.mentionRow}>
            <Text style={[s.mentionName, { color: colors.textSecondary }]}>
              {t('chat.mentions.empty', { defaultValue: '暂无可 @ 的成员' })}
            </Text>
          </View>
        }
      />
    </View>
  ) : null;
}
