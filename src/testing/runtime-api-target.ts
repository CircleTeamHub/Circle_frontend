const RUNTIME_API_TARGET_PREFIX = 'windnote_runtime_api_origin_';

export function buildRuntimeApiTargetId(apiUrl: string): string {
  const origin = new URL(apiUrl).origin;
  const encoded = Array.from(origin, (character) =>
    character.charCodeAt(0).toString(16).padStart(4, '0'),
  ).join('');
  return `${RUNTIME_API_TARGET_PREFIX}${encoded}`;
}
