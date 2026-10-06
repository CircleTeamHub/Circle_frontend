import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPOSER_DRAFTS_PER_ACCOUNT_MAX,
  draftPreviewText,
  isEmptyComposerDraft,
  pruneComposerDrafts,
  type ComposerDraft,
} from './composer-draft-model.ts';

const draft = (overrides: Partial<ComposerDraft> = {}): ComposerDraft => ({
  text: '',
  quoteMessageId: null,
  mentions: [],
  updatedAt: 1,
  ...overrides,
});

test('isEmptyComposerDraft: whitespace-only text without a quote is nothing to keep', () => {
  assert.equal(isEmptyComposerDraft(draft({ text: '  \n ' })), true);
  assert.equal(isEmptyComposerDraft(draft({ text: 'hi' })), false);
  // 只选了引用、还没打字:也是用户留下的半截操作,要保住。
  assert.equal(isEmptyComposerDraft(draft({ quoteMessageId: 'm-1' })), false);
});

test('draftPreviewText: one line, collapsed whitespace, bounded length', () => {
  assert.equal(draftPreviewText(draft({ text: '  第一行\n\n  第二行 ' })), '第一行 第二行');
  const long = 'a'.repeat(200);
  assert.equal(draftPreviewText(draft({ text: long })).length, 60);
});

test('pruneComposerDrafts keeps the most recently edited drafts per account', () => {
  const drafts: Record<string, ComposerDraft> = {};
  for (let index = 0; index < COMPOSER_DRAFTS_PER_ACCOUNT_MAX + 5; index += 1) {
    drafts[`c${index}`] = draft({ text: `t${index}`, updatedAt: index });
  }
  const pruned = pruneComposerDrafts(drafts);
  assert.equal(Object.keys(pruned).length, COMPOSER_DRAFTS_PER_ACCOUNT_MAX);
  assert.equal(pruned.c0, undefined);
  assert.equal(pruned[`c${COMPOSER_DRAFTS_PER_ACCOUNT_MAX + 4}`]?.text, `t${COMPOSER_DRAFTS_PER_ACCOUNT_MAX + 4}`);
});

test('pruneComposerDrafts returns the same object when under the cap', () => {
  const drafts = { c1: draft({ text: 'x' }) };
  assert.equal(pruneComposerDrafts(drafts), drafts);
});
