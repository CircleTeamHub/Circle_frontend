// Build seam for the real native storage and shared protocol, without mounting
// the application's unrelated UI. This is a bundling check, not a device test.
export { ProtocolDevice } from '@circle/e2ee';
export { openDeviceJournal } from '../../src/services/e2ee/journal';
