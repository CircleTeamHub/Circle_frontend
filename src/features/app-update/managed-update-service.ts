import * as Application from "expo-application";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getManagedUpdate } from "@/services/api/app-operations";
import { getDeviceId } from "@/services/auth/device-id";
import {
  parseManagedUpdate,
  type ManagedUpdate,
} from "./managed-update-policy";
export type { ManagedUpdate } from "./managed-update-policy";

export async function checkForManagedUpdate(): Promise<ManagedUpdate | null> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return null;
  if (
    (typeof __DEV__ !== "undefined" && __DEV__) ||
    Constants.expoConfig?.extra?.appVariant === "preprod"
  )
    return null;
  const build = Number(Application.nativeBuildVersion);
  if (!Number.isSafeInteger(build) || build < 1) return null;
  const device = await getDeviceId();
  if (!device) return null;
  // Release bucketing never exposes the authentication device identifier.
  const deviceHash=await digestStringAsync(CryptoDigestAlgorithm.SHA256,device);
  const installation=await digestStringAsync(CryptoDigestAlgorithm.SHA256,`circle-release:${deviceHash}`);
  const channel =
    Constants.expoConfig?.extra?.appVariant === "beta" ? "beta" : "stable";
  const query = new URLSearchParams({
    platform: Platform.OS,
    channel,
    build: String(build),
    installation,
  });
  const response = await getManagedUpdate(query);
  return parseManagedUpdate(response, Platform.OS, build);
}
