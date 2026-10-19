// Test-only host setup. Mobile code must use the OS CSPRNG, for example
// expo-crypto getRandomValues, and must never import node:crypto.
import { webcrypto } from 'node:crypto';
Object.defineProperty(globalThis, 'crypto', {
  value: Object.freeze({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }),
  configurable: true,
});
