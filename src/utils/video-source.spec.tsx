import { cachedVideoSource } from './video-source';

test('keeps the signed network URL intact while reusing its native cache across S3 signatures', () => {
  const first = 'https://media.example.com/chat/clip.mp4?X-Amz-Credential=old&X-Amz-Date=20261105&X-Amz-Signature=one';
  const next = 'https://media.example.com/chat/clip.mp4?X-Amz-Credential=new&X-Amz-Date=20261106&X-Amz-Signature=two';
  const source = cachedVideoSource(first);
  expect(source).toMatchObject({ uri: first, useCaching: true });
  expect(source.cacheKey).toBe(cachedVideoSource(next).cacheKey);
  expect(source.cacheKey).not.toContain('Credential');
});

test('ignores COS authentication fields but retains object versions and media transformations', () => {
  const base = 'https://media.example.com/clip.mp4?versionId=v1&size=720';
  const first = `${base}&q-sign-algorithm=sha1&q-ak=old&q-sign-time=1&q-key-time=1&q-header-list=host&q-url-param-list=&q-signature=one`;
  const next = `${base}&q-sign-algorithm=sha1&q-ak=new&q-sign-time=2&q-key-time=2&q-header-list=host&q-url-param-list=&q-signature=two`;
  expect(cachedVideoSource(first).cacheKey).toBe(cachedVideoSource(next).cacheKey);
  expect(cachedVideoSource(first).cacheKey).not.toBe(cachedVideoSource(first.replace('v1', 'v2')).cacheKey);
  expect(cachedVideoSource(first).cacheKey).not.toBe(cachedVideoSource(first.replace('720', '1080')).cacheKey);
  expect(cachedVideoSource(first).cacheKey).not.toBe(cachedVideoSource(first.replace('clip.mp4', 'other.mp4')).cacheKey);
});

test('excludes rotated COS temporary tokens without changing the authenticated request', () => {
  const first = 'https://media.example.com/clip.mp4?versionId=v1&x-cos-process=quality/80&x-cos-security-token=old&q-signature=one';
  const next = first.replace('x-cos-security-token=old', 'X-COS-SECURITY-TOKEN=new').replace('q-signature=one', 'q-signature=two');
  expect(cachedVideoSource(first).uri).toBe(first);
  expect(cachedVideoSource(next).uri).toBe(next);
  expect(cachedVideoSource(first).cacheKey).toBe(cachedVideoSource(next).cacheKey);
  expect(cachedVideoSource(first).cacheKey).not.toMatch(/security-token|old|new/i);
  expect(cachedVideoSource(first).cacheKey).toContain('x-cos-process=quality%2F80');
});

test.each(['file:///clip.mp4', 'content://media/42', 'blob:https://app.example.com/clip', 'ph://video'])('does not cache local media %s', (uri) => {
  expect(cachedVideoSource(uri)).toEqual({ uri, useCaching: false });
});

test('does not read or write the persistent cache for disappearing videos', () => {
  const uri = 'https://media.example.com/private.mp4?X-Amz-Signature=secret';
  expect(cachedVideoSource(uri, false)).toEqual({ uri, useCaching: false });
});

test('does not merge unrelated signed schemes or different origins', () => {
  const uri = 'https://media.example.com/clip.mp4?signature=a';
  expect(cachedVideoSource(uri).cacheKey).not.toBe(cachedVideoSource(uri.replace('signature=a', 'signature=b')).cacheKey);
  expect(cachedVideoSource(uri).cacheKey).not.toBe(cachedVideoSource(uri.replace('media.', 'other.')).cacheKey);
});

test.each(['clip.m3u8', 'clip.mpd'])('leaves adaptive streams on their existing uncached path: %s', (name) => {
  const uri = `https://media.example.com/${name}?X-Amz-Signature=secret`;
  expect(cachedVideoSource(uri)).toEqual({ uri, useCaching: false });
});
