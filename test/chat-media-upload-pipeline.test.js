const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// 聊天发图、发视频的上传管线接线。压缩与截封面本身的行为在各自的 jest spec 里;
// 这里守的是「管线真的用上了它们」—— 工具函数在、调用被删掉的话,那些 spec 照样全绿。
test('photos are shrunk and re-encoded before they are uploaded', () => {
  const src = read('src/features/chat/chat-detail/hooks/use-media-send.ts');
  const prepareAt = src.indexOf('await prepareChatImageForUpload(');
  const presignAt = src.indexOf('requestUploadPresign({', prepareAt);
  assert.ok(prepareAt > 0, '发图前要先压缩');
  assert.ok(presignAt > prepareAt, '压缩要在申请上传之前');
  const uploadBlock = src.slice(prepareAt, src.indexOf('await sendImageMessage(', prepareAt));
  // 上传、缩略图都用压缩后的文件,不能再拿原图。
  assert.match(uploadBlock, /fileUri: prepared\.uri/);
  assert.match(uploadBlock, /prepared\.contentType,\s*prepared\.uri,/);
  assert.match(uploadBlock, /uploadChatImageThumbnail\(\s*prepared\.uri,/);
  assert.doesNotMatch(uploadBlock, /uploadLocalFileToPresignedUrl\([^)]*asset\.uri/);
});

test('videos carry a poster frame and reuse it when a failed send is retried', () => {
  const src = read('src/features/chat/chat-detail/hooks/use-media-send.ts');
  assert.match(src, /await uploadChatVideoPoster\(/);
  assert.match(src, /uploaded = \{ key: presign\.key, thumbKey: poster\?\.key \}/);
  assert.match(src, /thumbKey: uploaded\.thumbKey/);
  const client = read('src/chat-core/client.ts');
  assert.match(client, /\.\.\.\(options\.thumbKey \? \{ thumbKey: options\.thumbKey \} : \{\}\)/);
});

test('iOS exports picked videos at 720p and says so while it works', () => {
  const src = read('src/features/chat/chat-detail/hooks/use-media-send.ts');
  assert.match(src, /kind === 'video' && Platform\.OS === 'ios'/);
  assert.match(src, /videoExportPreset: ImagePicker\.VideoExportPreset\.H264_1280x720/);
  assert.match(src, /chat\.detail\.videoPreparing/);
  // 提示必须在 finally 里收掉:用户取消选择、选择器报错时也不能挂在顶上。
  assert.match(src, /\} finally \{\s*if \(preparingNotice !== null\) hideTopNotice\(preparingNotice\);/);
});
