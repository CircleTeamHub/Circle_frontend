#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const stateDir = process.env.FAKE_COS_DIR;

function flag(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function keyFromUrl(value) {
  return value.replace(`cos://${process.env.COS_BUCKET}/`, '');
}

function objectPath(key) {
  return path.join(stateDir, `${Buffer.from(key).toString('base64url')}.json`);
}

function readObject(key) {
  const file = objectPath(key);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function writeObject(key, object) {
  fs.writeFileSync(objectPath(key), JSON.stringify(object));
}

function parseMetadata(value = '') {
  return Object.fromEntries(
    value.split('#').filter(Boolean).map((entry) => {
      const separator = entry.indexOf(':');
      return [entry.slice(0, separator).toLowerCase(), entry.slice(separator + 1)];
    }),
  );
}

if (command === 'gh') {
  const responses = (process.env.FAKE_GH_SHAS || process.env.GITHUB_SHA).split(',');
  const counterPath = path.join(stateDir, '.gh-counter');
  const count = fs.existsSync(counterPath)
    ? Number(fs.readFileSync(counterPath, 'utf8'))
    : 0;
  fs.writeFileSync(counterPath, String(count + 1));
  process.stdout.write(`${responses[Math.min(count, responses.length - 1)]}\n`);
  process.exit(0);
}

if (command === 'curl') {
  const requestUrl = args.at(-1);
  const fakeKey = new URL(requestUrl).searchParams.get('fake-key');
  if (flag('--write-out')) {
    const key = Buffer.from(fakeKey, 'base64url').toString();
    process.stdout.write(readObject(key) ? '206' : '404');
    process.exit(0);
  }

  const latest = readObject(`${process.env.COS_KEY_PREFIX}/latest/windnote.apk`);
  if (!latest) process.exit(22);
  let body = Buffer.from(latest.body, 'base64');
  if (
    process.env.FAKE_CORRUPT_PUBLIC === '1' &&
    requestUrl.includes('verification=build-')
  ) {
    body = Buffer.alloc(body.length, 120);
  }
  fs.writeFileSync(flag('--output'), body);
  fs.writeFileSync(
    flag('--dump-header'),
    [
      'HTTP/1.1 200 OK',
      `content-type: ${latest.metadata['content-type'] ?? 'application/octet-stream'}`,
      `content-disposition: ${latest.metadata['content-disposition'] ?? ''}`,
      `cache-control: ${latest.metadata['cache-control'] ?? ''}`,
      `content-length: ${body.length}`,
      '',
      '',
    ].join('\r\n'),
  );
  process.exit(0);
}

if (command !== 'coscli') {
  process.stderr.write(`unsupported fake command: ${command}\n`);
  process.exit(2);
}

if (args[0] === 'signurl') {
  const key = keyFromUrl(args[1]);
  process.stdout.write(
    `https://signed.invalid/object?fake-key=${Buffer.from(key).toString('base64url')}\n`,
  );
  process.exit(0);
}

if (args[0] === 'rm') {
  fs.rmSync(objectPath(keyFromUrl(args[1])), { force: true });
  process.exit(0);
}

if (args[0] !== 'cp') {
  process.stderr.write(`unsupported fake coscli operation: ${args.join(' ')}\n`);
  process.exit(2);
}

const source = args[1];
const destination = args[2];
const sourceIsCos = source.startsWith('cos://');
const destinationIsCos = destination.startsWith('cos://');

if (sourceIsCos && !destinationIsCos) {
  const object = readObject(keyFromUrl(source));
  if (!object) process.exit(1);
  fs.writeFileSync(destination, Buffer.from(object.body, 'base64'));
  process.exit(0);
}

if (!sourceIsCos && destinationIsCos) {
  const destinationKey = keyFromUrl(destination);
  if (readObject(destinationKey) && flag('--forbid-overwrite') === 'true') {
    process.exit(1);
  }
  if (
    destinationKey.endsWith('/latest/windnote.apk') &&
    source.endsWith('cos-previous.apk') &&
    process.env.FAKE_FAIL_RESTORE === '1'
  ) {
    process.exit(45);
  }
  writeObject(destinationKey, {
    body: fs.readFileSync(source).toString('base64'),
    metadata: parseMetadata(flag('--meta')),
    acl: flag('--acl') || 'private',
  });
  process.exit(0);
}

if (sourceIsCos && destinationIsCos) {
  const sourceKey = keyFromUrl(source);
  const destinationKey = keyFromUrl(destination);
  const object = readObject(sourceKey);
  if (!object) process.exit(1);
  writeObject(destinationKey, {
    body: object.body,
    // COSCLI v1.0.8 replaces metadata on object copies. The publisher must
    // therefore pass the complete destination metadata explicitly.
    metadata: parseMetadata(flag('--meta')),
    acl: flag('--acl') || 'private',
  });
  if (
    destinationKey.endsWith('/latest/windnote.apk') &&
    sourceKey.includes('/builds/') &&
    process.env.FAKE_FAIL_PROMOTE === 'ambiguous'
  ) {
    process.exit(42);
  }
  process.exit(0);
}

process.stderr.write(`unsupported fake copy: ${source} ${destination}\n`);
process.exit(2);
