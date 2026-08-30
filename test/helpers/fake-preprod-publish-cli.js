#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const stateDir = process.env.FAKE_R2_DIR;
const bucket = process.env.R2_BUCKET;

function flag(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function objectPath(key) {
  return path.join(stateDir, `${Buffer.from(key).toString('base64url')}.json`);
}

function readObject(key) {
  const file = objectPath(key);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeObject(key, value) {
  fs.writeFileSync(objectPath(key), JSON.stringify(value));
}

function parseMetadata(value = '') {
  return Object.fromEntries(
    value
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf('=');
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
  );
}

function failNotFound() {
  process.stderr.write('(404) Not Found\n');
  process.exit(1);
}

if (command === 'gh') {
  if (args.some((arg) => arg.includes('/compare/'))) {
    const cutoverSha = 'e09582dc7583fb7b69600e231dd76eb792d122f5';
    const compareHead =
      process.env.FAKE_EXPECTED_COMPARE_SHA || process.env.GITHUB_SHA;
    const expectedPath = `repos/${process.env.GITHUB_REPOSITORY}/compare/${cutoverSha}...${compareHead}`;
    const actualPath = args.find((arg) => arg.includes('/compare/'));
    if (actualPath !== expectedPath || flag('--jq') !== '.status') {
      process.stderr.write(
        `unexpected compare request: ${args.join(' ')}; expected ${expectedPath} --jq .status\n`,
      );
      process.exit(2);
    }
    process.stdout.write(`${process.env.FAKE_GH_COMPARE_STATUS || 'ahead'}\n`);
    process.exit(0);
  }
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
  const latest = readObject('android/preprod/latest/windnote.apk');
  if (!latest) failNotFound();
  let body = Buffer.from(latest.body, 'base64');
  if (process.env.FAKE_CORRUPT_PUBLIC === '1') {
    body = Buffer.alloc(body.length, 120);
  }
  fs.writeFileSync(flag('--output'), body);
  fs.writeFileSync(
    flag('--dump-header'),
    `HTTP/1.1 200 OK\r\ncontent-type: application/vnd.android.package-archive\r\ncontent-length: ${body.length}\r\n\r\n`,
  );
  process.exit(0);
}

if (command !== 'aws' || args[0] !== 's3api') {
  process.stderr.write(`unsupported fake command: ${command} ${args.join(' ')}\n`);
  process.exit(2);
}

const operation = args[1];
const key = flag('--key');

if (operation === 'head-object') {
  const object = readObject(key);
  if (!object) failNotFound();
  const query = flag('--query');
  const bodySize = Buffer.from(object.body, 'base64').length;
  if (query === '[ContentLength, Metadata.sha256, Metadata.package]') {
    process.stdout.write(
      `${bodySize}\t${object.metadata?.sha256 ?? 'None'}\t${object.metadata?.package ?? 'None'}\n`,
    );
  } else if (query === '[ContentLength, Metadata.sha256]') {
    process.stdout.write(`${bodySize}\t${object.metadata?.sha256 ?? 'None'}\n`);
  } else if (query === 'CacheControl') {
    process.stdout.write(`${object.cacheControl ?? 'None'}\n`);
  } else if (query === 'ContentType') {
    process.stdout.write(`${object.contentType ?? 'None'}\n`);
  }
  process.exit(0);
}

if (operation === 'put-object') {
  if (readObject(key) && flag('--if-none-match') === '*') process.exit(1);
  writeObject(key, {
    body: fs.readFileSync(flag('--body')).toString('base64'),
    metadata: parseMetadata(flag('--metadata')),
    cacheControl: flag('--cache-control'),
    contentType: flag('--content-type'),
  });
  process.exit(0);
}

if (operation === 'get-object') {
  const object = readObject(key);
  if (!object) failNotFound();
  fs.writeFileSync(args.at(-1), Buffer.from(object.body, 'base64'));
  process.exit(0);
}

if (operation === 'copy-object') {
  const sourceValue = flag('--copy-source');
  const sourceKey = sourceValue.startsWith(`${bucket}/`)
    ? sourceValue.slice(bucket.length + 1)
    : sourceValue;
  const source = readObject(sourceKey);
  if (!source) failNotFound();
  const restoring =
    key === 'android/preprod/latest/windnote.apk' &&
    sourceKey.startsWith('android/preprod/rollback/');
  if (restoring && process.env.FAKE_FAIL_RESTORE === '1') process.exit(45);

  const backingUp =
    key.startsWith('android/preprod/rollback/') &&
    sourceKey === 'android/preprod/latest/windnote.apk';

  writeObject(key, {
    ...source,
    ...(flag('--metadata-directive') === 'REPLACE'
      ? {
          metadata: parseMetadata(flag('--metadata')),
          cacheControl: flag('--cache-control'),
          contentType: flag('--content-type'),
        }
      : {}),
  });
  if (backingUp && process.env.FAKE_FAIL_BACKUP === 'ambiguous') process.exit(43);
  const promoting =
    key === 'android/preprod/latest/windnote.apk' &&
    sourceKey.startsWith('android/preprod/builds/');
  if (promoting && process.env.FAKE_FAIL_PROMOTE === 'ambiguous') process.exit(42);
  process.exit(0);
}

if (operation === 'delete-object') {
  fs.rmSync(objectPath(key), { force: true });
  process.exit(0);
}

process.stderr.write(`unsupported fake aws operation: ${operation}\n`);
process.exit(2);
