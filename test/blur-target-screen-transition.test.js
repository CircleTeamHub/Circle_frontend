const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

test('the chat blur target keeps its content drawn while a screen slides away (Android)', () => {
  // ChatDetailScreen wraps the message list in expo-blur's BlurTargetView so the glass composer
  // can blur it. That view hands its children to an inner view but did not forward
  // startViewTransition, which react-native-screens uses to keep a leaving screen drawn: on back
  // the list went black at once and the composer turned into a grey slab for the whole slide.
  const { version } = require('expo-blur/package.json');
  const patchPath = path.join(root, 'patches', `expo-blur+${version}.patch`);
  assert.ok(fs.existsSync(patchPath), `patches/expo-blur+${version}.patch missing — re-check the transition fix after upgrading expo-blur`);

  const patch = fs.readFileSync(patchPath, 'utf8');
  assert.match(patch, /ExpoBlurTargetView\.kt/);
  assert.match(patch, /\+ {2}override fun startViewTransition\(view: View\?\) \{[\s\S]*?\+ {4}blurTargetView\.startViewTransition\(view\)/);
  assert.match(patch, /\+ {2}override fun endViewTransition\(view: View\?\) \{[\s\S]*?\+ {4}blurTargetView\.endViewTransition\(view\)/);

  const screen = fs.readFileSync(path.join(root, 'src/features/chat/screens/ChatDetailScreen.tsx'), 'utf8');
  assert.match(screen, /<BlurTargetView ref=\{messageBlurTarget\}/);
});
