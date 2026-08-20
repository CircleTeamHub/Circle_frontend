function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function stringArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const result = value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} contains duplicate values.`);
  }
  return result;
}

export function parseAccounts(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Load account data must be a non-empty array.');
  }
  const aliases = new Set();
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`accounts[${index}] must be an object.`);
    }
    const alias = nonEmptyString(entry.alias, `accounts[${index}].alias`);
    if (aliases.has(alias)) throw new Error(`duplicate alias: ${alias}.`);
    aliases.add(alias);
    const accessToken = nonEmptyString(
      entry.accessToken,
      `accounts[${index}].accessToken`,
    );
    const conversationIds = stringArray(
      entry.conversationIds,
      `accounts[${index}].conversationIds`,
    );
    const circleIds = stringArray(
      entry.circleIds ?? [],
      `accounts[${index}].circleIds`,
    );
    return Object.freeze({ alias, accessToken, conversationIds, circleIds });
  });
}

export function selectAccount(accounts, sequence) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('No load accounts are available.');
  }
  if (!Number.isInteger(sequence)) throw new Error('Account sequence must be an integer.');
  const index = ((sequence - 1) % accounts.length + accounts.length) % accounts.length;
  return accounts[index];
}

export function summarizeAccounts(accounts) {
  return accounts.map((account) => ({
    alias: account.alias,
    conversations: account.conversationIds.length,
    circles: account.circleIds.length,
  }));
}
