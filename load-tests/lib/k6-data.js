import { SharedArray } from 'k6/data';
import { parseAccounts } from './data.js';

export function loadAccounts(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('LOAD_ACCOUNTS_FILE is required.');
  }
  return new SharedArray(`windnote-load-accounts:${filePath}`, () =>
    parseAccounts(JSON.parse(open(filePath))),
  );
}
