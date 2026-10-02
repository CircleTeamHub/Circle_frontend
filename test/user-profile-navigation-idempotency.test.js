const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    if (!/\.tsx?$/.test(entry.name) || /\.spec\.tsx?$/.test(entry.name)) return [];
    return [entryPath];
  });
}

test('user profile entries navigate idempotently instead of pushing duplicate screens', () => {
  const sourceRoot = path.join(process.cwd(), 'src');
  const offenders = collectSourceFiles(sourceRoot).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    if (!/router\.push\(\s*getUserProfileHref/.test(source)) return [];
    return [path.relative(process.cwd(), filePath)];
  });

  assert.deepEqual(
    offenders,
    [],
    `profile navigation must use router.navigate to avoid duplicate stack entries:\n${offenders.join('\n')}`,
  );
});

test('notification routes that resolve to profiles also navigate idempotently', () => {
  const snackbarHost = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/notifications/components/NotificationSnackbarHost.tsx',
    ),
    'utf8',
  );
  const notificationCenter = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/notifications/screens/NotificationCenterScreen.tsx',
    ),
    'utf8',
  );

  for (const source of [snackbarHost, notificationCenter]) {
    assert.match(source, /const route = getSnackbarRoute/);
    assert.match(source, /if \(isUserProfileSnackbarRoute\(route\)\)/);
    assert.match(source, /router\.navigate\(route\)/);
    assert.match(source, /router\.push\(route\)/);
  }
});
