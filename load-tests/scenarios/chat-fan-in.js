import { parseRuntimeConfig } from '../lib/config.js';
import { loadAccounts } from '../lib/k6-data.js';
import { buildThresholds } from '../lib/thresholds.js';
import { buildTextMessage, runChatSession, runReceiveSession } from '../lib/socket-session.js';
import { chatAckMs, chatDeliveryMs, chatSendFailed } from '../lib/metrics.js';

const config = parseRuntimeConfig(__ENV);
const accounts = loadAccounts(__ENV.LOAD_ACCOUNTS_FILE);
const targetIndex = Array.from(accounts).findIndex((account) => account.alias === config.targetAlias);
if (targetIndex < 0) throw new Error('LOAD_TARGET_ALIAS must identify the fan-in receiver.');

export const options = {
  scenarios: {
    receiver: {
      executor: 'per-vu-iterations',
      exec: 'receiveFanIn',
      vus: 1,
      iterations: 1,
      maxDuration: `${config.durationSeconds + 20}s`,
    },
    senders: {
      executor: 'per-vu-iterations',
      exec: 'sendFanIn',
      vus: config.vus,
      iterations: 1,
      startTime: '1s',
      maxDuration: `${config.durationSeconds + 20}s`,
    },
  },
  thresholds: buildThresholds(),
};

function senderForVu() {
  const senders = Array.from(accounts).filter((_, index) => index !== targetIndex);
  if (senders.length === 0) throw new Error('Fan-in requires at least one sender account.');
  return senders[(__VU - 1) % senders.length];
}

export function receiveFanIn() {
  runReceiveSession({
    config,
    account: accounts[targetIndex],
    durationSeconds: config.durationSeconds + 3,
  });
}

export function sendFanIn() {
  const account = senderForVu();
  if (account.conversationIds.length === 0) throw new Error(`${account.alias} has no shared conversation.`);
  const conversationId = account.conversationIds[0];
  const messages = Array.from({ length: config.messagesPerConversation }, (_, index) =>
    buildTextMessage(config, conversationId, index),
  );
  runChatSession({ config, account, messages });
}

void chatAckMs;
void chatDeliveryMs;
void chatSendFailed;
