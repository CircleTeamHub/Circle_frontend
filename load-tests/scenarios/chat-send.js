import { parseRuntimeConfig } from '../lib/config.js';
import { loadAccounts } from '../lib/k6-data.js';
import { selectAccount } from '../lib/data.js';
import { buildThresholds } from '../lib/thresholds.js';
import { buildTextMessage, runChatSession } from '../lib/socket-session.js';
import { chatAckMs, chatDeliveryMs, chatSendFailed } from '../lib/metrics.js';

const config = parseRuntimeConfig(__ENV);
const accounts = loadAccounts(__ENV.LOAD_ACCOUNTS_FILE);

export const options = {
  scenarios: {
    parallel_chat_senders: {
      executor: 'per-vu-iterations',
      vus: config.vus,
      iterations: 1,
      maxDuration: `${config.durationSeconds + 20}s`,
    },
  },
  thresholds: buildThresholds(),
};

export default function () {
  const account = selectAccount(accounts, __VU);
  if (account.conversationIds.length === 0) throw new Error(`${account.alias} has no conversationIds.`);
  const messages = [];
  for (let index = 0; index < config.messagesPerConversation; index += 1) {
    const conversationId = account.conversationIds[index % account.conversationIds.length];
    messages.push(buildTextMessage(config, conversationId, index));
  }
  runChatSession({ config, account, messages });
}

void chatAckMs;
void chatDeliveryMs;
void chatSendFailed;
