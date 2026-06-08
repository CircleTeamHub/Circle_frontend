import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Radius, Spacing, useTheme } from '@/theme';
import { formatRelativeTime } from '@/features/discover/utils/relative-time';
import type { NotificationRowData } from '@/features/notifications/utils/notification-summary';

interface Props {
  data: NotificationRowData;
  onPress: () => void;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm, gap: 11 },
  avatarWrap: { position: 'relative' },
  unreadDot: { position: 'absolute', top: -1, right: -1, width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF4D4F' },
  body: { flex: 1, gap: 5 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  preview: { width: 52, height: 52, borderRadius: Radius.sm },
});

export const NotificationRow = memo(function NotificationRow({ data, onPress }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable style={s.row} onPress={onPress}>
      <View style={s.avatarWrap}>
        <Avatar size={48} name={data.avatarName} uri={data.avatarUrl ?? undefined} />
        {data.unread ? <View style={s.unreadDot} /> : null}
      </View>
      <View style={s.body}>
        <View style={s.topRow}>
          <Text numberOfLines={1} style={{ flex: 1, marginRight: 6, fontSize: 16, fontWeight: '700', color: colors.text }}>
            {data.title}
          </Text>
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>{formatRelativeTime(data.createdAt, t)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Ionicons name={data.icon} size={13} color={colors.textSecondary} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: colors.textSecondary }}>
            {data.summary}
          </Text>
        </View>
      </View>
      {data.previewImage ? (
        <Image source={{ uri: data.previewImage }} style={s.preview} contentFit="cover" />
      ) : null}
    </Pressable>
  );
});
