import { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  type GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, Spacing, Typography } from '@/theme';
import type { CallRecordData, ChatMessage } from '@/types';
import { BubbleStatusText, MessageAvatar } from './shared';

interface CallRecordBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  /** 点卡片回拨（仅 1:1 会话传入；群通话回拨走群通话入口）。 */
  onCallBack?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  hideStatus?: boolean;
}

const sCallRecord = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: {
    justifyContent: 'flex-end',
  },
  body: {
    maxWidth: 240,
  },
  bodyOutgoing: {
    alignItems: 'flex-end',
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  label: {
    ...Typography.bodyRegular,
  },
  senderName: {
    ...Typography.caption,
    marginBottom: 2,
  },
});

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 结束原因 → 气泡文案。missed 只对接收方成立（发起方视角是「未接听」）。 */
function useCallRecordLabel(record: CallRecordData, outgoing: boolean) {
  const { t } = useTranslation();
  return useMemo(() => {
    // review 修复：接通过的通话不止 NORMAL 一种收尾 —— 双方都挂断走
    // ALL_LEFT，同样有真实时长。凡「接通过」的终局（带非空时长且不属于
    // 未接/取消/失败语义）都显示时长。
    const connectedEndReasons = new Set(['NORMAL', 'ALL_LEFT']);
    if (
      record.durationSeconds != null &&
      connectedEndReasons.has(record.endReason)
    ) {
      return t('chat.callRecord.duration', {
        duration: formatDuration(record.durationSeconds),
        defaultValue: '通话时长 {{duration}}',
      });
    }
    switch (record.endReason) {
      case 'CANCELED':
        return outgoing
          ? t('chat.callRecord.canceledBySelf', { defaultValue: '已取消' })
          : t('chat.callRecord.canceledByPeer', { defaultValue: '对方已取消' });
      case 'NO_ANSWER':
      case 'TIMEOUT':
        return outgoing
          ? t('chat.callRecord.noAnswer', { defaultValue: '对方未接听' })
          : t('chat.callRecord.missed', { defaultValue: '未接听' });
      case 'NETWORK':
      case 'ERROR':
        return t('chat.callRecord.failed', { defaultValue: '通话未接通' });
      default:
        return t('chat.callRecord.ended', { defaultValue: '通话已结束' });
    }
  }, [record, outgoing, t]);
}

export function CallRecordBubble({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
  onCallBack,
  onLongPress,
  hideStatus,
}: CallRecordBubbleProps) {
  const { colors } = useTheme();
  const record = message.callRecord;
  const label = useCallRecordLabel(
    record ?? {
      callId: '',
      callType: 'AUDIO',
      sessionType: 'single',
      endReason: 'NORMAL',
      durationSeconds: null,
      initiatorID: '',
    },
    outgoing,
  );
  if (!record) return null;

  const icon =
    record.callType === 'VIDEO' ? 'videocam-outline' : 'call-outline';
  const bubbleColor = outgoing ? colors.sentBubble : colors.receivedBubble;
  const textColor = outgoing ? colors.white : colors.text;

  return (
    <View style={[sCallRecord.row, outgoing && sCallRecord.rowOutgoing]}>
      {!outgoing ? (
        <Pressable onPress={onAvatarPress} disabled={!onAvatarPress}>
          <MessageAvatar
            message={message}
            outgoing={false}
            senderName={senderName}
            senderAvatarUri={senderAvatarUri}
          />
        </Pressable>
      ) : null}
      <View style={[sCallRecord.body, outgoing && sCallRecord.bodyOutgoing]}>
        {!outgoing && senderName ? (
          <Text style={[sCallRecord.senderName, { color: colors.textSecondary }]}>
            {senderName}
          </Text>
        ) : null}
        <Pressable
          onPress={onCallBack}
          onLongPress={onLongPress}
          // review 修复：群聊传 onCallBack=undefined，disabled 整体禁用会连
          // onLongPress（消息操作菜单：删除/转发）一起杀掉。只有两个回调都
          // 缺席才禁用；tap 行为由 onPress 本身是否存在决定。
          disabled={!onCallBack && !onLongPress}
          style={[sCallRecord.bubble, { backgroundColor: bubbleColor }]}
        >
          <Ionicons name={icon} size={18} color={textColor} />
          <Text style={[sCallRecord.label, { color: textColor }]}>{label}</Text>
        </Pressable>
        {outgoing && !hideStatus ? <BubbleStatusText message={message} /> : null}
      </View>
      {outgoing ? (
        <MessageAvatar
          message={message}
          outgoing
          selfName={selfName}
          selfAvatarUri={selfAvatarUri}
        />
      ) : null}
    </View>
  );
}
