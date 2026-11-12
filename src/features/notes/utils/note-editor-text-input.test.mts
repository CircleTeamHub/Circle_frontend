import test from 'node:test';
import assert from 'node:assert/strict';
import { routeMultilineTextInputToPaste } from './note-editor-text-input.ts';

function inputEvent(init: { inputType: string; data: string | null; cancelable?: boolean }) {
  let prevented = false;
  return {
    event: {
      inputType: init.inputType,
      data: init.data,
      cancelable: init.cancelable ?? true,
      preventDefault: () => {
        prevented = true;
      },
    },
    wasPrevented: () => prevented,
  };
}

test('an IME commit with line breaks is cancelled and pasted whole', () => {
  const pasted: string[] = [];
  const text = '第一段很长的内容\n第二段\r\n第三段';
  const { event, wasPrevented } = inputEvent({ inputType: 'insertText', data: text });

  assert.equal(routeMultilineTextInputToPaste(event, (value) => pasted.push(value)), true);
  assert.equal(wasPrevented(), true);
  assert.deepEqual(pasted, [text]);
});

test('single-line typing and commits keep the native input path', () => {
  const pasted: string[] = [];
  for (const data of ['a', '一段没有换行的长文本'.repeat(200), '', null]) {
    const { event, wasPrevented } = inputEvent({ inputType: 'insertText', data });
    assert.equal(routeMultilineTextInputToPaste(event, (value) => pasted.push(value)), false);
    assert.equal(wasPrevented(), false);
  }
  assert.deepEqual(pasted, []);
});

test('composition and other input types are left alone, as are uncancellable events', () => {
  const pasted: string[] = [];
  const cases = [
    inputEvent({ inputType: 'insertCompositionText', data: 'a\nb', cancelable: false }),
    inputEvent({ inputType: 'insertFromPaste', data: 'a\nb' }),
    inputEvent({ inputType: 'insertParagraph', data: null }),
    inputEvent({ inputType: 'insertText', data: 'a\nb', cancelable: false }),
  ];
  for (const { event, wasPrevented } of cases) {
    assert.equal(routeMultilineTextInputToPaste(event, (value) => pasted.push(value)), false);
    assert.equal(wasPrevented(), false);
  }
  assert.deepEqual(pasted, []);
});
