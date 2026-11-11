import { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { useAuthStore } from '@/stores/authStore';
import { allowPeerMediaUrl } from '@/services/api/utils';
import type { CallSession } from '@/features/call/types';

const WIDTH = 164;
const HEIGHT = 118;
const MARGIN = 12;

export function MiniCallWindow({
  call, connectionState, leaving, onRestore, onLeave,
}: {
  call: CallSession;
  connectionState: string;
  leaving: boolean;
  onRestore: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const selfId = useAuthStore((state) => state.user?.id);
  const peer = call.participants.find(({ user }) => user.id !== selfId)?.user;
  const position = useRef({ x: Math.max(MARGIN, width - WIDTH - MARGIN), y: insets.top + 68 });
  const translation = useRef(new Animated.ValueXY(position.current)).current;
  const bounds = useMemo(() => ({
    left: MARGIN,
    right: Math.max(MARGIN, width - WIDTH - MARGIN),
    top: insets.top + MARGIN,
    bottom: Math.max(insets.top + MARGIN, height - insets.bottom - HEIGHT - MARGIN),
  }), [height, insets.bottom, insets.top, width]);

  useEffect(() => {
    position.current = {
      x: Math.min(bounds.right, Math.max(bounds.left, position.current.x)),
      y: Math.min(bounds.bottom, Math.max(bounds.top, position.current.y)),
    };
    translation.setValue(position.current);
  }, [bounds, translation]);

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 6,
    onPanResponderMove: (_event, gesture) => {
      translation.setValue({
        x: Math.min(bounds.right, Math.max(bounds.left, position.current.x + gesture.dx)),
        y: Math.min(bounds.bottom, Math.max(bounds.top, position.current.y + gesture.dy)),
      });
    },
    onPanResponderRelease: (_event, gesture) => {
      position.current = {
        x: Math.min(bounds.right, Math.max(bounds.left, position.current.x + gesture.dx)),
        y: Math.min(bounds.bottom, Math.max(bounds.top, position.current.y + gesture.dy)),
      };
      translation.setValue(position.current);
    },
    onPanResponderTerminate: () => translation.setValue(position.current),
  }), [bounds, translation]);

  return (
    <Animated.View
      testID="mini-call-window"
      style={[styles.window, { transform: translation.getTranslateTransform() }]}
      {...pan.panHandlers}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={t('call.window.restore')} onPress={onRestore} style={styles.restore}>
        <View style={styles.identity}>
          {call.sessionType === 'group'
            ? <Ionicons name="people" size={28} color="#fff" />
            : <Avatar uri={allowPeerMediaUrl(peer?.avatarUrl) ?? undefined} size={34} />}
          <Ionicons name="expand-outline" size={16} color="#ddd" />
        </View>
        <Text style={styles.title} numberOfLines={1}>{call.sessionType === 'group' ? t('call.groupCallTitle') : peer?.nickname || t('call.typeVoice')}</Text>
        <Text style={styles.status}>{t(connectionState === 'connected' ? 'call.voice.connected' : 'call.voice.connecting')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('call.voice.hangUp')} disabled={leaving} onPress={onLeave} style={styles.hangUp}>
        <Ionicons name="call" size={18} color="#ff676f" style={styles.hangUpIcon} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  window: {
    position: 'absolute', width: WIDTH, height: HEIGHT, borderRadius: 14,
    backgroundColor: '#27232d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 10, elevation: 12,
  },
  restore: { flex: 1, padding: 10, paddingRight: 38, gap: 4 },
  identity: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 13, fontWeight: '600' },
  status: { color: '#d2ccd8', fontSize: 11 },
  hangUp: { position: 'absolute', right: 0, bottom: 4, width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  hangUpIcon: { transform: [{ rotate: '135deg' }] },
});
