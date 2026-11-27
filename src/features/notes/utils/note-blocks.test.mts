import test from 'node:test';
import assert from 'node:assert/strict';
import { dropTrailingEmptyParagraphs } from './note-blocks.ts';

const text = (value: string) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
const empty = { type: 'paragraph', content: [], children: [] };

test('drops the empty paragraphs BlockNote left at the end', () => {
  assert.deepEqual(dropTrailingEmptyParagraphs([text('一行字'), empty, { type: 'paragraph' }]), [text('一行字')]);
});

test('keeps blank lines between paragraphs and non-paragraph blocks at the end', () => {
  const list = { type: 'bulletListItem', content: [] };
  assert.deepEqual(dropTrailingEmptyParagraphs([text('a'), empty, text('b')]), [text('a'), empty, text('b')]);
  assert.deepEqual(dropTrailingEmptyParagraphs([text('a'), list]), [text('a'), list]);
});

test('an empty paragraph with nested children is content', () => {
  const parent = { type: 'paragraph', content: [], children: [text('child')] };
  assert.deepEqual(dropTrailingEmptyParagraphs([parent]), [parent]);
});

test('a document of only empty paragraphs becomes empty', () => {
  assert.deepEqual(dropTrailingEmptyParagraphs([empty, empty]), []);
});
