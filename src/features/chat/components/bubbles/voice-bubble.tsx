import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, type AudioStatus } from 'expo-audio';
import { useTheme, Spacing, Typography } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { toPlayableUri } from '@/im/media-uri';
import type { ChatMessage } from '@/types';
import { AVATAR_SIZE, BubbleStatusText } from './shared';

interface VoiceBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  hideStatus?: boolean;
}

const sVoice = StyleSheet.create({
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
    width: 200,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bubbleOutgoing: {
    borderBottomRightRadius: 4,
  },
  bubbleIncoming: {
    borderTopLeftRadius: 4,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  timeText: {
    ...Typography.small,
    minWidth: 30,
    textAlign: 'right',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  avatarSlot: { paddingBottom: 2 },
});

function formatSeconds(seconds: number) {
  return `${Math.max(0, Math.round(seconds))}"`;
}

export const VoiceBubble: React.FC<VoiceBubbleProps> = ({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
  hideStatus,
}) => {
  const { colors } = useTheme();
  const voiceSource = message.voiceUrl || message.voicePath || null;
  // 裸本地路径要补回 file:// scheme，否则 AVFoundation 打不开（FigFilePlayer err=-12864）。
  // useMemo 稳定 source 引用：每次渲染传新对象会让 expo-audio 反复重建 player。
  const audioSource = useMemo(
    () => (voiceSource ? { uri: toPlayableUri(voiceSource) } : null),
    [voiceSource],
  );
  const player = useAudioPlayer(audioSource);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);

  const bubbleColor = outgoing ? colors.sentBubble : colors.receivedBubble;
  const contentColor = outgoing ? colors.white : colors.text;

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setPlayerDuration(0);
    const subscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        setPlaying(Boolean(status.playing));
        setCurrentTime(status.currentTime ?? 0);
        if (status.duration && status.duration > 0) {
          setPlayerDuration(status.duration);
        }
        // 播完复位到起点，下次点击从头播；并把 UI 退回未播放态。
        if (status.didJustFinish) {
          player.pause();
          void player.seekTo(0);
          setPlaying(false);
          setCurrentTime(0);
        }
    });
    return () => {
      subscription.remove();
    };
  }, [player, voiceSource]);

  // 进度：优先用 player 探到的真实时长，回退到消息自带的录制时长。
  const totalDuration =
    playerDuration > 0 ? playerDuration : Math.max(1, message.voiceDuration ?? 1);
  const progress =
    totalDuration > 0
      ? Math.min(1, Math.max(0, currentTime / totalDuration))
      : 0;
  // 播放中显示已播秒数，否则显示总时长（与微信一致）。
  const displaySeconds = playing
    ? formatSeconds(currentTime)
    : formatSeconds(message.voiceDuration ?? totalDuration);

  const handlePress = () => {
    if (!voiceSource) return;
    if (playing) {
      player.pause();
      return;
    }
    void (async () => {
      // 播放前切到「外放 + 静音键下也响」；recording 期间会把 session 切成 PlayAndRecord
      // 走听筒，这里务必切回 Playback，否则像没声音。
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      // 只有播到结尾才从头开始，避免在未加载完成的 player 上 seekTo 抛错挡住 play()。
      if (totalDuration > 0 && currentTime >= totalDuration - 0.05) {
        try {
          await player.seekTo(0);
        } catch {
          // 未加载完成时 seek 失败可忽略，play() 会自行从头加载播放。
        }
      }
      player.play();
    })().catch((error) => {
      if (__DEV__) {
        console.warn(
          '[chat] voice play failed',
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
        );
      }
    });
  };

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const voiceNode = (
    <View style={[sVoice.body, outgoing ? sVoice.bodyOutgoing : null]}>
      <Pressable
        style={[
          sVoice.bubble,
          { backgroundColor: bubbleColor },
          outgoing ? sVoice.bubbleOutgoing : sVoice.bubbleIncoming,
          !voiceSource ? { opacity: 0.64 } : null,
        ]}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={playing ? '暂停语音消息' : '播放语音消息'}
        disabled={!voiceSource}
      >
        <Ionicons
          name={playing ? 'pause-circle' : 'play-circle'}
          size={26}
          color={contentColor}
        />
        <View
          style={[
            sVoice.progressTrack,
            { backgroundColor: contentColor, opacity: 0.85 },
          ]}
        >
          {/* 轨道底色用半透明，填充用实色覆盖 → 形成已播/未播对比。 */}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: contentColor, opacity: 0.3 },
            ]}
          />
          <View
            style={[
              sVoice.progressFill,
              {
                width: `${progress * 100}%`,
                backgroundColor: contentColor,
              },
            ]}
          />
        </View>
        <Text style={[sVoice.timeText, { color: contentColor }]}>
          {displaySeconds}
        </Text>
      </Pressable>
      {message.time ? (
        <View style={sVoice.timeRow}>
          <Text
            style={{
              ...Typography.tinyRegular,
              color: colors.textSecondary,
            }}
          >
            {message.time}
          </Text>
          {outgoing && !hideStatus ? <BubbleStatusText message={message} /> : null}
        </View>
      ) : null}
    </View>
  );

  if (outgoing) {
    return (
      <View style={[sVoice.row, sVoice.rowOutgoing]}>
        {voiceNode}
        <View style={sVoice.avatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sVoice.row}>
      {onAvatarPress ? (
        <Pressable style={sVoice.avatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sVoice.avatarSlot}>{avatarNode}</View>
      )}
      {voiceNode}
    </View>
  );
};
