import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import type { TempChatListItem } from '@/services/api/temp-chat';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface TempChatRowProps {
  room: TempChatListItem;
  isLast: boolean;
  /** 进群 / 结束请求在途时显示 loading，替换掉更多按钮。 */
  isBusy: boolean;
  /** 不可进入（非活跃或已有房间在打开中）时禁用整行点击。 */
  disabled: boolean;
  onOpen: (room: TempChatListItem) => void;
  onActions: (room: TempChatListItem) => void;
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
});

function formatDateTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const date = new Date(time);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getStatusKey(room: TempChatListItem): 'active' | 'expired' | 'ended' {
  if (room.isActive) return 'active';
  if (room.isExpired) return 'expired';
  return 'ended';
}

export default function TempChatRow({
  room,
  isLast,
  isBusy,
  disabled,
  onOpen,
  onActions,
}: TempChatRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      title: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
        flex: 1,
      },
      subtitle: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      activePill: { backgroundColor: 'rgba(34,197,94,0.14)' },
      inactivePill: { backgroundColor: colors.surface },
      activePillText: {
        color: '#16A34A',
        ...Typography.tiny,
        fontWeight: '600' as const,
      },
      inactivePillText: {
        color: colors.textSecondary,
        ...Typography.tiny,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const statusLabel = t(`tempChats.status.${getStatusKey(room)}`);

  return (
    <View>
      <Pressable style={s.row} disabled={disabled} onPress={() => onOpen(room)}>
        <Avatar size={42} name={room.title} />
        <View style={s.rowBody}>
          <View style={s.rowTop}>
            <Text style={d.title} numberOfLines={1}>
              {room.title}
            </Text>
            <View
              style={[
                s.statusPill,
                room.isActive ? d.activePill : d.inactivePill,
              ]}
            >
              <Text style={room.isActive ? d.activePillText : d.inactivePillText}>
                {statusLabel}
              </Text>
            </View>
          </View>
          <View style={s.rowMeta}>
            <Text style={d.subtitle}>
              {t('tempChats.guests', {
                count: room.guestCount,
                max: room.maxMembers,
              })}
            </Text>
            <Text style={d.subtitle}>
              {t('tempChats.expiresAt', {
                time: formatDateTime(room.expiresAt),
              })}
            </Text>
          </View>
        </View>
        {isBusy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : room.isActive ? (
          <Pressable
            hitSlop={8}
            accessibilityLabel={t('tempChats.more')}
            onPress={() => onActions(room)}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </Pressable>
      {isLast ? null : <Divider />}
    </View>
  );
}
