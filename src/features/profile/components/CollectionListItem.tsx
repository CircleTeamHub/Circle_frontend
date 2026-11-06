import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { UserCollection } from '@/services/api/collections';
import { getCollectedOpenIMMessagePayload } from '@/features/chat/utils/message-collection';
import type { CollectionContent } from '../collection-content';
import { CollectionContentPreview } from './CollectionContentPreview';
import { Spacing, useTheme, withAlpha } from '@/theme';

interface Props {
  item: UserCollection;
  content: CollectionContent;
  playing?: boolean;
  selected?: boolean;
  disabled?: boolean;
  unavailableReason?: string | null;
  onPress: () => void;
  onLongPress?: () => void;
  onSourcePress?: () => void;
}

/** The collection library and the send picker intentionally share the same card. */
export function CollectionListItem({ item, content, playing, selected, disabled, unavailableReason, onPress, onLongPress, onSourcePress }: Props) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const payload = getCollectedOpenIMMessagePayload(item.payload);
  const source = payload?.conversationTitle?.trim() || payload?.senderName?.trim() || item.message?.sender?.nickname || '';
  const date = new Date(item.createdAt);
  const timestamp = Number.isNaN(date.getTime()) ? '' : date.toDateString() === new Date().toDateString()
    ? t('profile.collections.today', { defaultValue: '今天' })
    : date.toLocaleDateString(i18n.language, { month: 'numeric', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}) });
  return (
    <Pressable testID={'collection-item-' + item.id} accessibilityRole={selected === undefined ? 'button' : 'checkbox'} accessibilityLabel={item.title}
      accessibilityState={{ ...(selected === undefined ? {} : { checked: selected }), disabled: Boolean(disabled) }}
      disabled={disabled} delayLongPress={300} onPress={onPress} onLongPress={onLongPress}
      style={({ pressed }) => [s.card, { backgroundColor: selected ? withAlpha(colors.primary, 0.08) : colors.surface,
        borderColor: selected ? colors.primary : 'transparent', opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }]}>
      {selected !== undefined ? <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={selected ? colors.primary : colors.textSecondary} /> : null}
      <View style={s.body}>
        {item.type === 'CHAT' && content.kind === 'text' && item.title !== content.text ? (
          <View style={s.chatPreview}>
            <Text style={[s.title, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
            <Text style={[s.summary, { color: colors.textSecondary }]} numberOfLines={2}>{content.text}</Text>
          </View>
        ) : <CollectionContentPreview content={content} playing={playing} />}
        {unavailableReason ? <Text style={[s.metaText, { color: colors.textSecondary }]} numberOfLines={2}>{unavailableReason}</Text> : null}
        <View style={s.footer}>
          {onSourcePress && selected === undefined ? (
            <Pressable style={s.source} accessibilityRole="button" accessibilityLabel={t('profile.collections.backToMessages', { defaultValue: '回到消息' })}
              disabled={disabled} onPress={onSourcePress} onLongPress={onLongPress}>
              <Text style={[s.metaText, { color: colors.textSecondary }]} numberOfLines={1}>{source}</Text>
            </Pressable>
          ) : <Text style={[s.metaText, s.source, { color: colors.textSecondary }]} numberOfLines={1}>{source}</Text>}
          <Text style={[s.metaText, { color: colors.textSecondary }]}>{timestamp}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  body: { flex: 1, minWidth: 0, gap: 12 },
  chatPreview: { gap: 8 },
  title: { fontSize: 17, lineHeight: 24 },
  summary: { fontSize: 15, lineHeight: 22 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  source: { flex: 1, minWidth: 0 },
  metaText: { fontSize: 13, lineHeight: 18 },
});
