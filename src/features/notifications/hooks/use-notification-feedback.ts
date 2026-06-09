import { useCallback, useEffect, useRef } from 'react';
import type { AudioPlayer } from 'expo-audio';
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
  const audioModuleRef = useRef<typeof import('expo-audio') | null>(null);
  const audioModulePromiseRef = useRef<Promise<typeof import('expo-audio') | null> | null>(null);
  const hapticsModuleRef = useRef<typeof import('expo-haptics') | null>(null);
  const hapticsModulePromiseRef = useRef<Promise<typeof import('expo-haptics') | null> | null>(null);
  const lastFiredRef = useRef(0);

  const ensureNotificationPlayer = useCallback(async function ensureNotificationPlayer() {
    if (playerRef.current) {
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
      const player = audioModule.createAudioPlayer(CHIME);
      playerRef.current = player;
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

  return useCallback(() => {
    const now = Date.now();
    if (now - lastFiredRef.current < MIN_GAP_MS) return;
    lastFiredRef.current = now;

    const { soundEnabled, hapticsEnabled } =
      useNotificationFeedbackStore.getState();

    if (hapticsEnabled) {
      void fireNotificationHaptic();
    }

    if (soundEnabled) {
      void ensureNotificationPlayer().then((player) => {
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
