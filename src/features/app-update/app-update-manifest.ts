export interface AndroidReleaseManifest {
  schemaVersion: 1;
  version: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
}

export function isAndroidUpdateAvailable(
  currentVersionCode: number,
  manifest: AndroidReleaseManifest,
): boolean {
  return (
    Number.isInteger(currentVersionCode) &&
    currentVersionCode > 0 &&
    manifest.versionCode > currentVersionCode
  );
}

export function parseGitHubReleaseManifest(
  value: unknown,
): AndroidReleaseManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid GitHub release manifest');
  }

  const manifest = value as Record<string, unknown>;
  const version =
    typeof manifest.version === 'string' ? manifest.version : '';
  const apkUrlValue =
    typeof manifest.apkUrl === 'string' ? manifest.apkUrl : '';
  const sha256 =
    typeof manifest.sha256 === 'string' ? manifest.sha256 : '';
  const sizeBytes =
    typeof manifest.sizeBytes === 'number' ? manifest.sizeBytes : 0;
  const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
    version,
  );
  if (!versionMatch) {
    throw new Error('Invalid GitHub release manifest');
  }

  const [major, minor, patch] = versionMatch.slice(1).map(Number);
  const expectedVersionCode = major * 1_000_000 + minor * 1000 + patch;
  if (
    minor >= 1000 ||
    patch >= 1000 ||
    !Number.isSafeInteger(expectedVersionCode) ||
    expectedVersionCode <= 0 ||
    manifest.schemaVersion !== 1 ||
    manifest.versionCode !== expectedVersionCode ||
    !apkUrlValue ||
    !/^[0-9a-f]{64}$/i.test(sha256) ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    throw new Error('Invalid GitHub release manifest');
  }

  let apkUrl: URL;
  try {
    apkUrl = new URL(apkUrlValue);
  } catch {
    throw new Error('Invalid GitHub release manifest');
  }

  const expectedPath =
    `/CircleTeamHub/windnote-releases/releases/download/v${version}/windnote.apk`;
  if (
    apkUrl.protocol !== 'https:' ||
    apkUrl.hostname !== 'github.com' ||
    apkUrl.username ||
    apkUrl.password ||
    apkUrl.pathname !== expectedPath ||
    apkUrl.search ||
    apkUrl.hash
  ) {
    throw new Error('Invalid GitHub release manifest');
  }

  return {
    schemaVersion: 1,
    version,
    versionCode: expectedVersionCode,
    apkUrl: apkUrl.href,
    sha256,
    sizeBytes,
  };
}
