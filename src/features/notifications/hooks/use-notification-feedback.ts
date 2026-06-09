import { useCallback, useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useNotificationFeedbackStore } from '@/features/notifications/store/use-notification-feedback-store';

// Generated placeholder chime — replace assets/sounds/notification.wav to
// rebrand without touching code.
const CHIME = require('../../../../assets/sounds/notification.wav');

// Don't machine-gun the cue when several banners advance in quick succession.
const MIN_GAP_MS = 1500;

/**
 * Returns a stable `notify()` that fires the banner's sound + haptic cue,
 * gated by user preferences and throttled. All native calls are guarded so a
 * dev client that hasn't been rebuilt with the new native modules degrades to
 * a no-op instead of crashing.
 */
export function useNotificationFeedback(): () => void {
  const playerRef = useRef<AudioPlayer | null>(null);
  const lastFiredRef = useRef(0);

  useEffect(() => {
    let player: AudioPlayer | null = null;
    try {
      player = createAudioPlayer(CHIME);
      playerRef.current = player;
      // Respect the iOS silent switch — never force audio in silent mode.
      void setAudioModeAsync({ playsInSilentMode: false }).catch(() => {});
    } catch {
      playerRef.current = null;
    }

    return () => {
      try {
        player?.remove();
      } catch {
        // ignore teardown errors
      }
      playerRef.current = null;
    };
  }, []);

  return useCallback(() => {
    const now = Date.now();
    if (now - lastFiredRef.current < MIN_GAP_MS) return;
    lastFiredRef.current = now;

    const { soundEnabled, hapticsEnabled } =
      useNotificationFeedbackStore.getState();

    if (hapticsEnabled) {
      // A single light tap — neutral for an incoming message/notification.
      // notificationAsync(Success) is a celebratory two-pulse pattern that
      // feels wrong for routine pings.
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => {},
      );
    }

    if (soundEnabled && playerRef.current) {
      try {
        playerRef.current.seekTo(0);
        playerRef.current.play();
      } catch {
        // player not ready / native module unavailable — skip silently
      }
    }
  }, []);
}
