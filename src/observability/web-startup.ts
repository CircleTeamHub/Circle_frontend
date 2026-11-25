/** The inline web probe runs before Metro and is absent on native platforms. */
export function markWebStartupStage(stage: 'sentry' | 'page'): void {
  const probe = (globalThis as typeof globalThis & {
    __WINDNOTE_WEB_STARTUP__?: { sentryReady: () => void; ready: () => void };
  }).__WINDNOTE_WEB_STARTUP__;
  if (stage === 'sentry') probe?.sentryReady();
  else probe?.ready();
}
