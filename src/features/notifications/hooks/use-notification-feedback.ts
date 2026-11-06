import { useCallback, useEffect, useRef } from 'react';
import type { AudioPlayer } from 'expo-audio';
import { useNotificationFeedbackStore, type NotificationRingtone } from '@/features/notifications/store/use-notification-feedback-store';

// Swift gesture by notificationsounds.com (CC BY 4.0); see assets/legal/asset-notices.json.
const CHIMES = {
  default: require('../../../../assets/sounds/notification_swift_gesture.wav'),
  soft: require('../../../../assets/sounds/notification-soft.wav'),
  bell: require('../../../../assets/sounds/notification-bell.wav'),
};

// Don't machine-gun the cue when several banners advance in quick succession.
const MIN_GAP_MS = 1500;

/**
 * Returns a stable `notify()` that fires the banner's sound + haptic cue,
 * gated by user preferences and throttled. All native calls are guarded so a
 * dev client that hasn't been rebuilt with the new native modules degrades to
 * a no-op instead of crashing.
 */
export function useNotificationFeedback(): (options?: {
  silent?: boolean;
  kind?: 'message' | 'circle';
}) => void {
  const playerRef = useRef<AudioPlayer | null>(null);
  const playerRingtoneRef = useRef<NotificationRingtone | null>(null);
  const audioModuleRef = useRef<typeof import('expo-audio') | null>(null);
  const audioModulePromiseRef = useRef<Promise<typeof import('expo-audio') | null> | null>(null);
  const hapticsModuleRef = useRef<typeof import('expo-haptics') | null>(null);
  const hapticsModulePromiseRef = useRef<Promise<typeof import('expo-haptics') | null> | null>(null);
  const lastFiredRef = useRef(0);

  const ensureNotificationPlayer = useCallback(async function ensureNotificationPlayer(ringtone: NotificationRingtone) {
    if (playerRef.current && playerRingtoneRef.current === ringtone) {
      return playerRef.current;
    }

    if (!audioModulePromiseRef.current) {
      audioModulePromiseRef.current = import('expo-audio')
        .then((mod) => {
          audioModuleRef.current = mod;
          return mod;
        })
        .catch(() => null);
    }

    const audioModule = audioModuleRef.current ?? await audioModulePromiseRef.current;
    if (!audioModule) {
      return null;
    }

    try {
      if (playerRef.current && playerRingtoneRef.current === ringtone) return playerRef.current;
      playerRef.current?.remove();
      const player = audioModule.createAudioPlayer(CHIMES[ringtone] ?? CHIMES.default);
      playerRef.current = player;
      playerRingtoneRef.current = ringtone;
      // Respect the iOS silent switch — never force audio in silent mode.
      void audioModule.setAudioModeAsync({ playsInSilentMode: false }).catch(() => {});
      return player;
    } catch {
      playerRef.current = null;
      return null;
    }
  }, []);

  const fireNotificationHaptic = useCallback(async function fireNotificationHaptic() {
    if (!hapticsModulePromiseRef.current) {
      hapticsModulePromiseRef.current = import('expo-haptics')
        .then((mod) => {
          hapticsModuleRef.current = mod;
          return mod;
        })
        .catch(() => null);
    }

    const hapticsModule = hapticsModuleRef.current ?? await hapticsModulePromiseRef.current;
    if (!hapticsModule) {
      return;
    }

    // A single light tap — neutral for an incoming message/notification.
    // notificationAsync(Success) is a celebratory two-pulse pattern that
    // feels wrong for routine pings.
    await hapticsModule
      .impactAsync(hapticsModule.ImpactFeedbackStyle.Light)
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      try {
        playerRef.current?.remove();
      } catch {
        // ignore teardown errors
      }
      playerRef.current = null;
    };
  }, []);

  // silent：调用方已知这条通知不该出声（例如圈子通知的「声音提醒」被关掉）。
  // 震动不受它影响 —— 产品语义是「静音」，不是「无提醒」。
  return useCallback((options?: { silent?: boolean; kind?: 'message' | 'circle' }) => {
    const now = Date.now();
    if (now - lastFiredRef.current < MIN_GAP_MS) return;
    lastFiredRef.current = now;

    const { soundEnabled, hapticsEnabled, messageRingtone, circleRingtone } =
      useNotificationFeedbackStore.getState();

    if (hapticsEnabled) {
      void fireNotificationHaptic();
    }

    if (soundEnabled && !options?.silent) {
      const ringtone = (options?.kind === 'circle' ? circleRingtone : messageRingtone) ?? 'default';
      void ensureNotificationPlayer(ringtone).then((player) => {
        if (!player) return;

        try {
          player.seekTo(0);
          player.play();
        } catch {
          // player not ready / native module unavailable — skip silently
        }
      });
    }
  }, [ensureNotificationPlayer, fireNotificationHaptic]);
}
