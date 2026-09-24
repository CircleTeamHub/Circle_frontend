import { storage } from '@/storage';

export const AMAP_PRIVACY_CONSENT_VERSION = '2026-09-23';

const AMAP_PRIVACY_CONSENT_KEY = 'privacy.amap.consent-version';

export function hasAmapPrivacyConsent(): boolean {
  return storage.getString(AMAP_PRIVACY_CONSENT_KEY) === AMAP_PRIVACY_CONSENT_VERSION;
}

export function grantAmapPrivacyConsent(): void {
  storage.set(AMAP_PRIVACY_CONSENT_KEY, AMAP_PRIVACY_CONSENT_VERSION);
}
