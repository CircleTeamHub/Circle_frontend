const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: {
        '@/*': ['src/*'],
      },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier in stubs) {
        return stubs[specifier];
      }

      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

const i18nStub = {
  default: {
    t: (key, params) => {
      const name = params?.name ?? '';
      const translations = {
        'contacts.friendActivity.copy.requestReceived': `${name} 请求添加你为好友`,
        'contacts.friendActivity.copy.requestSent': `你已向 ${name} 发送好友申请`,
        'contacts.friendActivity.copy.requestAcceptedByOther': `${name} 通过了你的好友申请`,
        'contacts.friendActivity.copy.requestRejectedByOther': `${name} 拒绝了你的好友申请`,
        'contacts.friendActivity.copy.requestAcceptedByMe': `你已通过 ${name} 的好友申请`,
        'contacts.friendActivity.copy.requestRejectedByMe': `你已拒绝 ${name} 的好友申请`,
        'contacts.friendActivity.copy.requestWithdrawnByOther': `${name} 撤回了好友申请`,
        'contacts.friendActivity.copy.default': `${name} 的好友动态`,
      };

      return translations[key] ?? key;
    },
  },
};

test('friend activity copy maps event types to inbox text and groups inbox rows by counterparty', () => {
  const {
    getFriendActivityCopy,
    hasUnreadFriendActivities,
    buildFriendActivityInboxRows,
  } = loadTsModule('src/features/contacts/friend-activities.ts', {
    '@/i18n': i18nStub,
  });

  assert.match(
    getFriendActivityCopy({
      type: 'REQUEST_RECEIVED',
      counterparty: { nickname: 'Jimmy', accountId: 'jimmy' },
    }),
    /请求添加你为好友/,
  );
  assert.match(
    getFriendActivityCopy({
      type: 'REQUEST_ACCEPTED_BY_OTHER',
      counterparty: { nickname: 'Jimmy', accountId: 'jimmy' },
    }),
    /通过了你的好友申请/,
  );
  assert.equal(hasUnreadFriendActivities(1), true);
  assert.equal(hasUnreadFriendActivities(0), false);

  const rows = buildFriendActivityInboxRows([
    {
      id: 'activity-accepted',
      type: 'REQUEST_ACCEPTED_BY_ME',
      requestId: 'request-1',
      requestState: 'ACCEPTED',
      messageSnapshot: null,
      readAt: null,
      createdAt: '2026-04-09T10:00:00.000Z',
      counterparty: {
        id: 'user-1',
        accountId: 'tomcoming',
        nickname: 'tomcoming',
        avatarUrl: null,
      },
    },
    {
      id: 'activity-request',
      type: 'REQUEST_RECEIVED',
      requestId: 'request-1',
      requestState: 'PENDING',
      messageSnapshot: null,
      readAt: null,
      createdAt: '2026-04-08T10:00:00.000Z',
      counterparty: {
        id: 'user-1',
        accountId: 'tomcoming',
        nickname: 'tomcoming',
        avatarUrl: null,
      },
    },
    {
      id: 'activity-jimmy',
      type: 'REQUEST_SENT',
      requestId: 'request-2',
      requestState: 'PENDING',
      messageSnapshot: null,
      readAt: '2026-04-09T09:00:00.000Z',
      createdAt: '2026-04-09T09:00:00.000Z',
      counterparty: {
        id: 'user-2',
        accountId: 'jimmy',
        nickname: 'Jimmy',
        avatarUrl: null,
      },
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].activity.id, 'activity-accepted');
  assert.deepEqual(
    Array.from(rows[0].unreadActivityIds),
    ['activity-accepted', 'activity-request'],
  );
  assert.equal(rows[1].activity.id, 'activity-jimmy');
  assert.deepEqual(Array.from(rows[1].unreadActivityIds), []);
});

test('friend activity API helpers use activity endpoints', async () => {
  const calls = [];
  const apiClientStub = async (endpoint, options) => {
    calls.push({ endpoint, options });

    if (endpoint === '/friend/activities/unread-count') {
      return { count: 2 };
    }

    if (endpoint === '/friend/activities') {
      return [];
    }

    if (endpoint === '/friend/activities/activity-1') {
      return {
        id: 'activity-1',
        type: 'REQUEST_RECEIVED',
        requestId: 'request-1',
        requestState: 'PENDING',
        messageSnapshot: 'hello',
        readAt: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        counterparty: {
          id: 'user-2',
          accountId: 'jimmy',
          nickname: 'Jimmy',
          avatarUrl: null,
        },
      };
    }

    return undefined;
  };

  const {
    fetchFriendActivities,
    fetchUnreadFriendActivityCount,
    markFriendActivityRead,
    fetchFriendActivityDetail,
  } = loadTsModule('src/services/api/friends.ts', {
    '@/services/api/client': { apiClient: apiClientStub },
    '@/services/api/utils': {
      allowPeerMediaUrl: (value) => value ?? null,
      normalizeMediaUrl: (value) => value,
      normalizeAvatarFrameAppearance: (value) => value ?? null,
      // `fetchCountEndpoint` 是 batch 6 extract 的小辅助函数 —— 这里复用同一个
      // apiClientStub 让测试断言依然能 push 到 calls。
      fetchCountEndpoint: async (endpoint) => {
        const result = await apiClientStub(endpoint);
        return result.count;
      },
    },
  });

  await fetchFriendActivities();
  const unread = await fetchUnreadFriendActivityCount();
  await fetchFriendActivityDetail('activity-1');
  await markFriendActivityRead('activity-1');

  assert.equal(unread, 2);
  assert.deepEqual(
    calls.map((call) => call.endpoint),
    [
      '/friend/activities',
      '/friend/activities/unread-count',
      '/friend/activities/activity-1',
      '/friend/activities/activity-1/read',
    ],
  );
  assert.equal(calls[3].options.method, 'POST');
});
