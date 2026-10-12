const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('realtime note status events update the note signal and reconnect recovery pokes it', () => {
  const source = read('src/realtime/client.ts');
  assert.match(source, /type: 'note\.source\.status\.changed'/);
  assert.match(source, /case 'note\.source\.status\.changed':/);
  assert.match(source, /isNoteSourceStatusChange\(message\.payload\)/);
  assert.match(
    source,
    /useNoteStatusSignalStore\.getState\(\)\.bump\(message\.payload\)/,
  );
  assert.match(
    source,
    /useChatStore\.getState\(\)\.applyNoteSourceStatus\(/,
    '实时状态变更应立即覆盖已缓存的聊天笔记卡片',
  );
  assert.match(
    source,
    /function runPostAuthenticationRecovery\(\): void \{[\s\S]*?useNoteStatusSignalStore\.getState\(\)\.bump\(\)/,
  );
});

test('note list patches source status without reloading and reordering', () => {
  const notesScreen = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(notesScreen, /useNoteStatusSignalStore\(\(state\) => state\.lastChange\)/);
  assert.match(notesScreen, /applyNoteSourceStatusToSummaries/);
  assert.doesNotMatch(notesScreen, /useNoteStatusSignalStore\(\(state\) => state\.version\)/);
  assert.match(notesScreen, /\}, \[load, noteListVersion\]\),/);
  const detail = read('src/features/notes/screens/NoteDetailScreen.tsx');
  assert.match(
    detail,
    /useNoteStatusSignalStore\(\(state\) => state\.version\)/,
  );
  const management = read('src/features/notes/screens/NoteManagementScreen.tsx');
  // 管理页只消费变更内容做原地 patch,不订阅 version 触发整页重新拉取和重排。
  assert.match(management, /useNoteStatusSignalStore/);
  assert.match(management, /state\.lastChange/);
  assert.doesNotMatch(management, /state\.version/);
});

test('note status signal keeps the latest source change and advances monotonically', () => {
  const { useNoteStatusSignalStore } = loadTsModule(
    'src/features/notes/store/use-note-status-signal-store.ts',
    {
      requireShim: (specifier) => {
        if (specifier === 'zustand') return require('zustand');
        throw new Error(`unexpected import: ${specifier}`);
      },
    },
  );
  useNoteStatusSignalStore.getState().reset();
  const change = {
    sourceNoteId: 'note-1',
    workStatus: 'CLOSED',
    status: 'ACTIVE',
    available: true,
    changedAt: '2026-10-09T12:00:00.000Z',
  };
  useNoteStatusSignalStore.getState().bump(change);
  assert.equal(useNoteStatusSignalStore.getState().version, 1);
  assert.deepEqual(useNoteStatusSignalStore.getState().lastChange, change);
  useNoteStatusSignalStore.getState().bump();
  assert.equal(useNoteStatusSignalStore.getState().version, 2);
  assert.deepEqual(useNoteStatusSignalStore.getState().lastChange, change);
});
