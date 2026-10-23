import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { useAuthStore } from "@/stores/authStore";
import { recordAppOpen } from "@/services/api/app-operations";
import { getDeviceId } from "@/services/auth/device-id";

/** First-party coarse usage only. No screen text, messages, contacts, or navigation params. */
export function AppOperationsHost() {
  const authenticated = useAuthStore((s) => s.isAuthenticated && !s.isLoading && !!s.accessToken),
    epoch = useAuthStore((s) => s.sessionEpoch);
  useEffect(() => {
    if (!authenticated) return;
    let disposed = false,
      inFlight = false,
      lastSuccess = 0,
      pendingID: string | null = null;
    const record = async () => {
      if (disposed || inFlight || Date.now() - lastSuccess < 5 * 60_000) return;
      inFlight = true;
      try {
        const device = await getDeviceId();
        if (
          !device ||
          disposed ||
          useAuthStore.getState().sessionEpoch !== epoch
        )
          return;
        pendingID ??= randomUUID();
        const rawBuild = Number(Application.nativeBuildVersion ?? 0);
        await recordAppOpen({
            platform:
              Platform.OS === "ios"
                ? "ios"
                : Platform.OS === "android"
                  ? "android"
                  : "web",
            appVersion:
              Application.nativeApplicationVersion ??
              Constants.expoConfig?.version ??
              "unknown",
            build:
              Number.isSafeInteger(rawBuild) && rawBuild >= 0 ? rawBuild : 0,
            channel:
              Constants.expoConfig?.extra?.appVariant === "beta"
                ? "beta"
                : "stable",
            eventID: pendingID,
        });
        pendingID = null;
        lastSuccess = Date.now();
      } catch {
        /* A failed coarse usage event never interrupts the user's work; retry on foreground. */
      } finally {
        inFlight = false;
      }
    };
    if (AppState.currentState === "active") void record();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void record();
    });
    return () => {
      disposed = true;
      subscription.remove();
    };
  }, [authenticated, epoch]);
  return null;
}
