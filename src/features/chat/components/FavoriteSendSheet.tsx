import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { CollectionContentPreview } from '@/features/profile/components/CollectionContentPreview';
import { resolveCollectionContent } from '@/features/profile/collection-content';
import type { UserCollection } from '@/services/api/collections';
import { useChatStore } from '@/chat-core/store';
import { useTheme } from '@/theme';
import { EmojiPicker } from './emoji-picker';
import { useKeyboardVisible } from '@/features/chat/chat-detail/hooks/use-keyboard-visible';

export function FavoriteSendSheet({ item, recipient, onCancel, onConfirm }: {
  item: UserCollection;
  recipient: { name: string; avatarUrl?: string } | null;
  onCancel: () => void;
  onConfirm: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { colors, resolvedMode } = useTheme();
  const insets = useSafeAreaInsets();
  const userID = useChatStore(state => state.currentUserId);
  const [message, setMessage] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const { keyboardVisible } = useKeyboardVisible();
  const content = resolveCollectionContent(item, userID);
  const cancel = () => { Keyboard.dismiss(); onCancel(); };
  return <BottomSheetModal visible onClose={cancel} avoidKeyboard={!emojiOpen}
    sheetStyle={[s.sheet, { backgroundColor: resolvedMode === 'dark' ? colors.surface : colors.pinnedSurface, paddingBottom: keyboardVisible && !emojiOpen ? 16 : Math.max(insets.bottom, 24) + (emojiOpen ? 0 : 48) }]}>
    <View testID="favorite-send-sheet" style={s.content}>
      <Text style={[s.heading, { color: colors.text }]}>{t('share.favoriteConfirm.sendTo', { defaultValue: '发送给' })}</Text>
      <ScrollView style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={s.recipient}>
          <Avatar size={48} shape="square" name={recipient?.name} uri={recipient?.avatarUrl} />
          <Text style={[s.name, { color: colors.text }]} numberOfLines={2}>
            {recipient?.name || t('share.favoriteConfirm.missingRecipient', { defaultValue: '当前聊天不可用，请返回后重试' })}
          </Text>
        </View>
        <View style={s.preview}><CollectionContentPreview content={content} expanded /></View>
        <View style={s.messageRow}>
          <TextInput testID="favorite-additional-message" accessibilityLabel={t('share.favoriteConfirm.messageLabel', { defaultValue: '附加消息' })}
            placeholder={t('share.favoriteConfirm.messagePlaceholder', { defaultValue: '输入附加消息（可选）' })}
            placeholderTextColor={colors.textSecondary} value={message} onChangeText={setMessage} multiline
            onFocus={() => setEmojiOpen(false)} style={[s.input, { color: colors.text, backgroundColor: colors.surface }]} />
          <Pressable accessibilityRole="button" accessibilityLabel={t('chat.detail.emojiPanelLabel', { defaultValue: '打开表情面板' })}
            accessibilityState={{ expanded: emojiOpen }} style={s.emojiButton}
            onPress={() => { Keyboard.dismiss(); setEmojiOpen(open => !open); }}>
            <Ionicons name="happy-outline" size={28} color={colors.text} />
          </Pressable>
        </View>
        {emojiOpen ? <EmojiPicker onSelect={emoji => setMessage(text => text + emoji)} /> : null}
      </ScrollView>
      <View style={s.actions}>
        <Pressable accessibilityRole="button" style={[s.action, { backgroundColor: colors.surfaceBorder }]} onPress={cancel}>
          <Text style={[s.actionText, { color: colors.text }]}>{t('common.cancel', { defaultValue: '取消' })}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !recipient }} disabled={!recipient}
          style={[s.action, { backgroundColor: recipient ? '#079B50' : colors.surfaceBorder }]}
          onPress={() => { Keyboard.dismiss(); onConfirm(message.trim()); }}>
          <Text style={[s.actionText, { color: colors.white }]}>{t('common.send', { defaultValue: '发送' })}</Text>
        </Pressable>
      </View>
    </View>
  </BottomSheetModal>;
}

const s = StyleSheet.create({
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24, maxHeight: '90%' },
  content: { flexShrink: 1, gap: 12 },
  heading: { fontSize: 17, fontWeight: '600' },
  scroll: { flexShrink: 1 },
  body: { gap: 8 },
  recipient: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { flex: 1, fontSize: 17, fontWeight: '500' },
  preview: { minHeight: 120, justifyContent: 'center' },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: 46, maxHeight: 100, borderRadius: 8, padding: 12, fontSize: 16, textAlignVertical: 'center' },
  emojiButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignSelf: 'center', gap: 16 },
  action: { minWidth: 112, minHeight: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  actionText: { fontSize: 18, fontWeight: '600' },
});
