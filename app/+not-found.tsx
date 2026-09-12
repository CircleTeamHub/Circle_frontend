import { Redirect } from 'expo-router';

/**
 * Native launches from a bare custom-scheme URL (for example `windnoteai:///`)
 * do not contain a route segment. Keep those launches inside the app instead
 * of leaving the user on Expo Router's generic unmatched-route screen.
 *
 * Route through the root index so auth/session bootstrap can finish before
 * any protected screen starts fetching user-scoped data. The index decides
 * whether this should become messages, onboarding, or login.
 */
export default function NotFound() {
  return <Redirect href="/" />;
}
