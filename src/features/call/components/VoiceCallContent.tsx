import { useMemo, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { useChatStore } from '@/chat-core/store';
import { useAuthStore } from '@/stores/authStore';
import { allowPeerMediaUrl } from '@/services/api/utils';
import { reportHandledFailure } from '@/observability/report-failure';
import type { CallSession } from '@/features/call/types';
import type { LiveKitModule } from '@/features/call/livekit-module';
import { Radius, Spacing, Typography } from '@/theme';

export const VOICE_CALL_BACKGROUND = '#19171c';
const WHITE = '#fff';
const SECONDARY = 'rgba(255, 255, 255, 0.72)';
const HANG_UP = '#ff4d55';
const SPEAKING = '#b5a7ff';

interface VoiceCallContentProps {
  call: CallSession;
  participants: ReturnType<LiveKitModule['useParticipants']>;
  localIdentity: string;
  connectionState: string;
  micEnabled: boolean;
  muting: boolean;
  leaving: boolean;
  onToggleMic: () => void;
  onLeave: () => void;
  setSpeakerphone?: LiveKitModule['setSpeakerphone'];
}

export function VoiceCallContent({
  call, participants, localIdentity, connectionState, micEnabled, muting,
  leaving, onToggleMic, onLeave, setSpeakerphone,
}: VoiceCallContentProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const selfId = useAuthStore((state) => state.user?.id) ?? localIdentity;
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === call.conversationID),
  );
  const [speakerEnabled, setSpeakerEnabled] = useState(false);
  const [speakerBusy, setSpeakerBusy] = useState(false);
  const group = call.sessionType === 'group';
  const peer = group ? undefined :
    call.participants.find(({ user }) => user.id !== selfId)?.user ?? conversation?.peer;
  const groupTitle = conversation?.myRemark || conversation?.circle?.name ||
    conversation?.name || conversation?.tempChat?.title;
  const title = group
    ? groupTitle || t('call.groupCallTitle')
    : peer?.nickname || t('call.typeVoice');
  const avatar = allowPeerMediaUrl(group
    ? conversation?.circle?.avatarUrl ?? conversation?.avatarUrl
    : peer?.avatarUrl);
  const users = useMemo(
    () => new Map(call.participants.map(({ user }) => [user.id, user])),
    [call.participants],
  );
  // LiveKit includes the local placeholder before the room has an identity.
  const online = participants.filter(({ identity }) => Boolean(identity));
  const waiting = call.status === 'RINGING' && !online.some(({ identity }) => identity !== selfId);
  const reconnecting = connectionState === 'reconnecting' || connectionState === 'signalReconnecting';
  const connecting = connectionState === 'connecting' || reconnecting || waiting;
  const status = reconnecting
    ? t('call.status.reconnecting')
    : connectionState === 'connecting'
      ? t('call.voice.connecting')
      : connectionState !== 'connected'
        ? t('call.status.disconnected')
        : waiting
          ? t(group ? 'call.voice.waitingGroup' : 'call.voice.waitingPeer')
          : t('call.voice.connected');

  const toggleSpeaker = async () => {
    if (!setSpeakerphone || speakerBusy) return;
    setSpeakerBusy(true);
    try {
      await setSpeakerphone(!speakerEnabled);
      setSpeakerEnabled(!speakerEnabled);
    } catch (error) {
      reportHandledFailure('call', 'selectAudioOutput', error);
      Alert.alert(t('call.voice.speakerUnavailable'));
    } finally {
      setSpeakerBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + 38 }]}>
      <StatusBar style="light" />
      {avatar ? (
        <>
          <Image
            accessible={false}
            source={{ uri: avatar }}
            style={styles.backdrop}
            contentFit="cover"
            blurRadius={46}
            cachePolicy="memory-disk"
            transition={0}
          />
          <View pointerEvents="none" style={styles.scrim} />
        </>
      ) : null}

      {group ? (
        <FlatList
          data={online}
          numColumns={3}
          style={styles.groupBody}
          contentContainerStyle={styles.groupList}
          columnWrapperStyle={styles.groupRow}
          keyExtractor={(item) => item.identity}
          ListHeaderComponent={(
            <View style={styles.groupHeader}>
              <GroupChatAvatar uri={avatar} size={50} />
              <View style={styles.groupHeading}>
                <Text style={styles.groupTitle} numberOfLines={2}>{title}</Text>
                <Text style={styles.secondary}>{t('call.participantsOnline', { count: online.length })}</Text>
              </View>
            </View>
          )}
          renderItem={({ item }) => {
            const user = users.get(item.identity);
            const local = item.identity === selfId;
            const name = local ? t('call.self') :
              user?.nickname || item.name || t('call.invite.groupMember');
            const muted = local ? !micEnabled : item.isMicrophoneEnabled === false;
            const speaking = !muted && item.isSpeaking;
            return (
              <View style={[styles.memberTile, speaking && styles.speakingTile]}>
                <View>
                  <Avatar uri={allowPeerMediaUrl(user?.avatarUrl) ?? undefined} size={44} />
                  {muted || speaking ? (
                    <View
                      accessible
                      accessibilityLabel={t(muted ? 'call.voice.participantMuted' : 'call.voice.participantSpeaking')}
                      style={styles.memberBadge}
                    >
                      <Ionicons name={muted ? 'mic-off' : 'mic'} size={12} color={speaking ? SPEAKING : WHITE} />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
              </View>
            );
          }}
        />
      ) : (
        <View style={styles.privateBody}>
          <View style={styles.privateAvatar}>
            <Avatar uri={avatar ?? undefined} size={88} />
          </View>
          <Text style={styles.privateTitle} numberOfLines={2}>{title}</Text>
          {connecting ? (
            <View accessible accessibilityLabel={status} style={styles.dots}>
              <View style={[styles.dot, { opacity: 0.3 }]} />
              <View style={[styles.dot, { opacity: 0.52 }]} />
              <View style={[styles.dot, { opacity: 0.76 }]} />
            </View>
          ) : <Text style={styles.secondary}>{status}</Text>}
        </View>
      )}

      {group ? <Text style={styles.groupStatus}>{status}</Text> : null}
      <View style={styles.controls}>
        <VoiceControl
          icon={micEnabled ? 'mic' : 'mic-off'}
          label={t(micEnabled ? 'call.voice.micOn' : 'call.voice.micOff')}
          active={micEnabled}
          busy={muting}
          disabled={leaving}
          onPress={onToggleMic}
        />
        <VoiceControl
          icon="call"
          label={t(waiting && call.initiator.id === selfId ? 'common.cancel' : 'call.voice.hangUp')}
          hangUp
          busy={leaving}
          onPress={onLeave}
        />
        {setSpeakerphone ? (
          <VoiceControl
            icon={speakerEnabled ? 'volume-high' : 'volume-mute'}
            label={t(speakerEnabled ? 'call.voice.speakerOn' : 'call.voice.speaker')}
            active={speakerEnabled}
            busy={speakerBusy}
            disabled={leaving || connectionState !== 'connected'}
            onPress={toggleSpeaker}
          />
        ) : null}
      </View>
    </View>
  );
}

function VoiceControl({
  icon, label, active, busy, disabled, hangUp, onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  active?: boolean;
  busy: boolean;
  disabled?: boolean;
  hangUp?: boolean;
  onPress: () => void;
}) {
  const foreground = active ? '#141316' : WHITE;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, selected: active }}
      disabled={busy || disabled}
      onPress={onPress}
      style={styles.action}
    >
      <View style={[
        styles.button,
        active && styles.activeButton,
        hangUp && styles.hangUpButton,
        disabled && styles.disabledButton,
      ]}>
        {busy ? <ActivityIndicator color={foreground} /> : (
          <Ionicons name={icon} size={hangUp ? 31 : 27} color={foreground} style={hangUp && styles.hangUpIcon} />
        )}
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', paddingHorizontal: Spacing.lg },
  backdrop: { ...StyleSheet.absoluteFillObject, transform: [{ scale: 1.15 }] },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 13, 17, 0.48)' },
  privateBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 58, gap: Spacing.md },
  privateAvatar: { borderRadius: Radius.lg, overflow: 'hidden' },
  privateTitle: { color: WHITE, fontSize: 24, fontWeight: '600', textAlign: 'center' },
  secondary: { ...Typography.small, color: SECONDARY },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: WHITE },
  groupBody: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center' },
  groupList: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  groupHeading: { flex: 1, gap: Spacing.xs },
  groupTitle: { color: WHITE, fontSize: 24, fontWeight: '600' },
  groupRow: { gap: Spacing.sm },
  memberTile: {
    width: '31.5%',
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.sm,
    gap: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    backgroundColor: 'rgba(15, 13, 17, 0.46)',
  },
  speakingTile: { borderColor: SPEAKING, backgroundColor: 'rgba(121, 99, 208, 0.32)' },
  memberBadge: {
    position: 'absolute', right: -4, bottom: -4, width: 19, height: 19, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#25232b',
  },
  memberName: { ...Typography.small, color: WHITE, textAlign: 'center' },
  groupStatus: { ...Typography.small, color: SECONDARY, textAlign: 'center', marginVertical: Spacing.md },
  controls: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start',
    width: '100%', maxWidth: 390, alignSelf: 'center',
  },
  action: { flex: 1, alignItems: 'center', gap: Spacing.sm },
  button: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  activeButton: { backgroundColor: WHITE },
  hangUpButton: { backgroundColor: HANG_UP },
  hangUpIcon: { transform: [{ rotate: '135deg' }] },
  disabledButton: { opacity: 0.55 },
  actionLabel: { ...Typography.small, color: WHITE, textAlign: 'center' },
});
