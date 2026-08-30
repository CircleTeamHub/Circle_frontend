import Constants from 'expo-constants';
import { qrSchemeForAppVariant } from './qr-payload';

export const OUTBOUND_APP_QR_SCHEME = qrSchemeForAppVariant(
  Constants.expoConfig?.extra?.appVariant,
);
