import {
  parseGitHubReleaseManifest,
  type AndroidReleaseManifest,
} from "./app-update-manifest";
export interface ManagedUpdate {
  mandatory: boolean;
  platform: "android" | "ios";
  version: string;
  url: string;
  manifest?: AndroidReleaseManifest;
}
export function parseManagedUpdate(
  value: unknown,
  platform: string,
  currentBuild: number,
): ManagedUpdate | null {
  if (!value || typeof value !== "object")
    throw new Error("Invalid update decision");
  const decision = value as { update?: unknown; mandatory?: unknown };
  if (decision.update === null) return null;
  if (
    !decision.update ||
    typeof decision.update !== "object" ||
    typeof decision.mandatory !== "boolean"
  )
    throw new Error("Invalid update decision");
  const update = decision.update as Record<string, unknown>;
  if (
    update.platform !== platform ||
    !Number.isSafeInteger(update.versionCode) ||
    Number(update.versionCode) <= currentBuild
  )
    throw new Error("Invalid update target");
  if (platform === "android") {
    const manifest = parseGitHubReleaseManifest(update);
    return {
      platform,
      mandatory: decision.mandatory,
      version: manifest.version,
      url: manifest.apkUrl,
      manifest,
    };
  }
  const url = new URL(String(update.apkUrl));
  if (
    platform !== "ios" ||
    url.protocol !== "https:" ||
    url.hostname !== "apps.apple.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/\/id\d+$/.test(url.pathname) ||
    typeof update.version !== "string"
  )
    throw new Error("Invalid App Store update");
  return {
    platform,
    mandatory: decision.mandatory,
    version: update.version,
    url: url.href,
  };
}
