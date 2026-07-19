const crypto = require('node:crypto');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function defaultRunGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function invoke(runGh, args, { allowFailure = false } = {}) {
  const result = runGh(args);
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr || `gh ${args.join(' ')} failed.`);
  }
  return result;
}

function allowNotFound(result, resource) {
  if (result.status === 0) return result;
  if (/HTTP 404|Not Found/i.test(result.stderr ?? '')) return result;
  throw new Error(result.stderr || `Failed to look up ${resource}.`);
}

function parseStableVersion(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag ?? '');
  return match ? match.slice(1).map(Number) : null;
}

function isNewerStableVersion(candidate, current) {
  const next = parseStableVersion(candidate);
  const previous = parseStableVersion(current);
  if (!next || !previous) return false;

  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== previous[index]) return next[index] > previous[index];
  }
  return false;
}

function shouldPromoteLatest(candidate, current) {
  return (
    !current || candidate === current || isNewerStableVersion(candidate, current)
  );
}

function fileDigest(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest('hex')}`;
}

function publishRelease({
  releaseTag,
  repository,
  apkPath,
  runGh = defaultRunGh,
}) {
  const encodedTag = encodeURIComponent(releaseTag);
  const releaseResult = allowNotFound(
    invoke(
      runGh,
      ['api', `repos/${repository}/releases/tags/${encodedTag}`],
      { allowFailure: true },
    ),
    `release ${releaseTag}`,
  );
  const latestResult = allowNotFound(
    invoke(
      runGh,
      ['api', `repos/${repository}/releases/latest`, '--jq', '.tag_name'],
      { allowFailure: true },
    ),
    'latest release',
  );
  const latestTag = latestResult.status === 0 ? latestResult.stdout.trim() : '';
  const promoteLatest = shouldPromoteLatest(releaseTag, latestTag);
  const assetSpec = `${apkPath}#windnote.apk`;

  if (releaseResult.status === 0) {
    const release = JSON.parse(releaseResult.stdout);
    const existingAsset = release.assets?.find(
      (asset) => asset.name === 'windnote.apk',
    );

    if (existingAsset) {
      const localDigest = fileDigest(apkPath);
      if (existingAsset.digest !== localDigest) {
        throw new Error(
          `Release ${releaseTag} already has windnote.apk with a different digest. Publish a new version tag instead.`,
        );
      }
    } else {
      invoke(runGh, [
        'release',
        'upload',
        releaseTag,
        assetSpec,
        '--repo',
        repository,
      ]);
    }
  } else {
    invoke(runGh, [
      'release',
      'create',
      releaseTag,
      assetSpec,
      '--repo',
      repository,
      '--title',
      `windnote ${releaseTag}`,
      '--notes',
      'Official windnote Android release.',
      '--latest=false',
    ]);
  }

  if (promoteLatest) {
    invoke(runGh, [
      'release',
      'edit',
      releaseTag,
      '--repo',
      repository,
      '--latest',
    ]);
  }

  return { promoteLatest };
}

function writePromoteLatestOutput(promoteLatest, outputPath) {
  fs.appendFileSync(outputPath, `promote_latest=${promoteLatest}\n`);
}

function main() {
  const { promoteLatest } = publishRelease({
    releaseTag: process.env.RELEASE_TAG,
    repository: process.env.RELEASE_REPOSITORY,
    apkPath: process.env.APK_PATH,
  });
  writePromoteLatestOutput(promoteLatest, process.env.GITHUB_OUTPUT);
}

if (require.main === module) main();

module.exports = {
  isNewerStableVersion,
  publishRelease,
  shouldPromoteLatest,
  writePromoteLatestOutput,
};
