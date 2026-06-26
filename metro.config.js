// Wraps the default Expo Metro config with Sentry's serializer so production
// builds can emit source maps for readable stack traces. Behaves exactly like
// the Expo default when Sentry is not configured.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

module.exports = config;
