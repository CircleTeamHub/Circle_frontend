/**
 * Pure decision logic shared by "forward voice" and "send collected voice".
 *
 * A voice message can be re-sent either from a remote CDN url (preferred —
 * no re-upload) or, as a fallback, from a still-present local file path.
 * Keeping this pure (no OpenIM SDK import) makes it unit-testable and gives
 * both call sites one source of truth instead of duplicated branching.
 */
export type VoiceSendStrategy =
  | { kind: 'url'; sourceUrl: string; soundPath?: string }
  | { kind: 'path'; soundPath: string };

export function resolveVoiceSendStrategy(input: {
  sourceUrl?: string | null;
  soundPath?: string | null;
}): VoiceSendStrategy | null {
  const sourceUrl = input.sourceUrl?.trim();
  const soundPath = input.soundPath?.trim();

  if (sourceUrl) {
    return { kind: 'url', sourceUrl, soundPath: soundPath || undefined };
  }
  if (soundPath) {
    return { kind: 'path', soundPath };
  }
  return null;
}
