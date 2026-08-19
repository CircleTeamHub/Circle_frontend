const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
  'utf8',
);
const mediaSheetSource = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/chat/components/media-source-sheet.tsx',
  ),
  'utf8',
);
const photoEditorSource = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/chat/components/photo-editor-modal.tsx',
  ),
  'utf8',
);
const freeCropperSource = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/chat/components/free-photo-cropper.tsx',
  ),
  'utf8',
);
const markupEditorSource = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/features/chat/components/photo-markup-editor.tsx',
  ),
  'utf8',
);

const attachmentItems =
  source.match(/const ATTACHMENT_ITEMS:[\s\S]*?^\];/m)?.[0] ?? '';

test('chat attachment panel merges photos, videos, and camera into one media entry', () => {
  const ids = [...attachmentItems.matchAll(/\{ id: '([^']+)'/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(ids.slice(0, 8), [
    'media',
    'voice-call',
    'location',
    'notes',
    'friend-card',
    'favorites',
    'transfer',
    'quick-reply',
  ]);
  assert.equal(ids.length, 8);
  assert.match(attachmentItems, /chat\.attachments\.mediaHub/);
  assert.doesNotMatch(attachmentItems, /id: 'camera'/);

  assert.match(mediaSheetSource, /id: 'photo'/);
  assert.match(mediaSheetSource, /id: 'video'/);
  assert.match(mediaSheetSource, /id: 'camera'/);
  assert.match(source, /mediaTypes: kind === 'photo' \? \['images'\] : \['videos'\]/);
  assert.match(source, /setMediaSourceSheetVisible\(true\)/);
  assert.match(source, /<MediaSourceSheet/);
  assert.match(mediaSheetSource, /justifyContent: 'center'/);
  assert.match(mediaSheetSource, /flexDirection: 'row'/);
});

test('picked and captured photos open the editor before any upload starts', () => {
  assert.match(source, /setPhotoEditorAsset\(pickedAsset\)/);
  assert.match(source, /setPhotoEditorAsset\(result\.assets\[0\]\)/);
  assert.match(source, /<PhotoEditorModal/);
  assert.match(source, /onSend=\{handleSendEditedPhoto\}/);
  assert.match(source, /const accepted = await uploadAndSendImageAsset\(asset\)/);

  // 视频不经过照片编辑器，继续走原有的视频发送策略。
  assert.match(source, /await uploadAndSendVideoAsset\(pickedAsset\)/);
});

test('photo editor copy stays localized in every supported language', () => {
  for (const locale of ['zh', 'en', 'es', 'ja', 'ko']) {
    const messages = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), `src/i18n/locales/${locale}.json`),
        'utf8',
      ),
    );
    assert.equal(typeof messages.chat.photoEditor.title, 'string');
    assert.equal(typeof messages.chat.photoEditor.cropSquare, 'string');
    assert.equal(typeof messages.chat.photoEditor.freeCrop, 'string');
    assert.equal(typeof messages.chat.photoEditor.cropHint, 'string');
    assert.equal(typeof messages.chat.photoEditor.mosaic, 'string');
    assert.equal(typeof messages.chat.photoEditor.mosaicHint, 'string');
    assert.equal(typeof messages.chat.photoEditor.draw, 'string');
    assert.equal(typeof messages.chat.photoEditor.drawColor, 'string');
    assert.equal(typeof messages.chat.photoEditor.undo, 'string');
    assert.equal(typeof messages.chat.photoEditor.editFailedMessage, 'string');
  }
});

test('photo editor supports localized blur painting, freehand drawing, and undo', () => {
  assert.match(photoEditorSource, /id: 'mosaic'/);
  assert.match(photoEditorSource, /id: 'draw'/);
  assert.match(photoEditorSource, /<PhotoMarkupEditor/);
  assert.match(photoEditorSource, /markupRef\.current\?\.undo\(\)/);
  assert.match(photoEditorSource, /DRAW_COLORS\.map/);
  assert.match(markupEditorSource, /PanResponder\.create/);
  assert.match(markupEditorSource, /<Mask/);
  assert.match(markupEditorSource, /<Blur/);
  assert.match(markupEditorSource, /tool === 'mosaic'/);
  assert.match(markupEditorSource, /drawAsImage/);
  assert.match(markupEditorSource, /encodeToBytes/);
});

test('photo editor supports a movable free-form crop frame with four resize handles', () => {
  assert.match(photoEditorSource, /<FreePhotoCropper/);
  assert.match(photoEditorSource, /handleApplyCrop/);
  assert.match(photoEditorSource, /freeCropTitle/);
  assert.match(freeCropperSource, /PanResponder\.create/);
  assert.match(freeCropperSource, /createResponder\('topLeft'\)/);
  assert.match(freeCropperSource, /createResponder\('topRight'\)/);
  assert.match(freeCropperSource, /createResponder\('bottomLeft'\)/);
  assert.match(freeCropperSource, /createResponder\('bottomRight'\)/);
  assert.match(freeCropperSource, /moveDisplayCrop/);
  assert.match(freeCropperSource, /mapDisplayCropToPhotoPixels/);
});
