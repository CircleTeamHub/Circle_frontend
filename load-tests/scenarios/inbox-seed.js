import { parseRuntimeConfig } from '../lib/config.js';
import { loadAccounts } from '../lib/k6-data.js';
import { selectAccount } from '../lib/data.js';
import { buildThresholds } from '../lib/thresholds.js';
import { buildTextMessage, runChatSession } from '../lib/socket-session.js';
import { chatAckMs, chatDeliveryMs, chatSendFailed } from '../lib/metrics.js';

const config = parseRuntimeConfig(__ENV);
const accounts = loadAccounts(__ENV.LOAD_ACCOUNTS_FILE);
if (__ENV.LOAD_PERFORMANCE_FIXTURE !== 'true') {
  throw new Error('LOAD_PERFORMANCE_FIXTURE=true is required for inbox seeding.');
}

export const options = {
  scenarios: {
    seed_large_inboxes: {
      executor: 'per-vu-iterations',
      vus: Math.min(config.vus, accounts.length),
      iterations: 1,
      maxDuration: `${config.durationSeconds + 60}s`,
    },
  },
  thresholds: buildThresholds({ ackP95Ms: 2000, deliveryP95Ms: 3500, maxFailureRate: 0.01 }),
};

export default function () {
  const account = selectAccount(accounts, __VU);
  const conversations = account.conversationIds.slice(0, config.conversations);
  if (conversations.length < config.conversations) {
    throw new Error(`${account.alias} has ${conversations.length} conversations; ${config.conversations} required.`);
  }
  const messages = [];
  for (const conversationId of conversations) {
    for (let sequence = 0; sequence < config.messagesPerConversation; sequence += 1) {
      messages.push(buildTextMessage(config, conversationId, sequence));
    }
  }
  runChatSession({ config, account, messages, keepOpenMs: 3000 });
}

void chatAckMs;
void chatDeliveryMs;
void chatSendFailed;
