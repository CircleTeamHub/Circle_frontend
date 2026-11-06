// Exercise the journal and its consumers without a native storage bridge.
// Tests which inspect persistence/privacy use the real adapter with their own
// storage boundary; native persistence itself is covered by the Node suite.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
