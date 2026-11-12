type TextInputEventLike = Pick<
  InputEvent,
  'inputType' | 'data' | 'cancelable' | 'preventDefault'
>;

/**
 * Android IMEs insert a clipboard-panel pick (Gboard, Sogou, Baidu, iFlytek…)
 * with InputConnection.commitText, so the editor sees a `beforeinput`
 * `insertText`, not a `paste` event. Chromium turns every '\n' in committed
 * text into a paragraph split that clones the block's `.bn-inline-content`
 * element in place, and BlockNote's block parse rule only reads the first
 * `.bn-inline-content`, so every line after the first is silently dropped.
 *
 * Multi-line committed text is cancelled here and handed to `pasteText`,
 * the same pipeline the system paste uses, which splits lines into blocks.
 * Single-line input keeps the native path so typing, IME composition and
 * input rules behave as before. Returns whether the event was rerouted.
 */
export function routeMultilineTextInputToPaste(
  event: TextInputEventLike,
  pasteText: (text: string) => void,
): boolean {
  if (event.inputType !== 'insertText' || !event.cancelable) return false;
  const text = event.data;
  if (!text || !/[\r\n]/.test(text)) return false;
  event.preventDefault();
  pasteText(text);
  return true;
}
