import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function requiredMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`Unable to parse ${label}.`);
  return Number(match[1]);
}

export function parseAndroidGfxInfo(text) {
  return {
    totalFrames: requiredMatch(text, /Total frames rendered:\s*(\d+)/i, 'total frames'),
    jankyFrames: requiredMatch(text, /Janky frames:\s*(\d+)/i, 'janky frames'),
    jankyFramePercent: requiredMatch(
      text,
      /Janky frames:\s*\d+\s*\(([\d.]+)%\)/i,
      'janky frame percent',
    ),
    frameP95Ms: requiredMatch(text, /95th percentile:\s*([\d.]+)ms/i, 'frame p95'),
    missedVsync: requiredMatch(text, /Number Missed Vsync:\s*(\d+)/i, 'missed vsync'),
  };
}

export function parseAndroidMemInfo(text) {
  const modern = text.match(/TOTAL PSS:\s*(\d+)/i);
  const table = text.match(/^\s*TOTAL\s+(\d+)\b/m);
  const value = modern ?? table;
  if (!value) throw new Error('Unable to parse Android TOTAL PSS.');
  return { totalPssKb: Number(value[1]) };
}

const IOS_KEYS = {
  janky_frames_percent: 'jankyFramePercent',
  memory_baseline_mb: 'memoryBaselineMb',
  memory_peak_mb: 'memoryPeakMb',
  open_conversation_p95_ms: 'openConversationP95Ms',
  crashes: 'crashes',
  watchdogs: 'watchdogs',
};

export function parseIosMetrics(text) {
  const result = {};
  const lines = String(text).trim().split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const [metric, rawValue] = line.split(',').map((value) => value.trim());
    const key = IOS_KEYS[metric];
    if (!key) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid iOS metric ${metric}.`);
    }
    result[key] = value;
  }
  return result;
}

function positiveOverride(env, key, fallback) {
  if (env[key] === undefined || env[key] === '') return fallback;
  const value = Number(env[key]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive finite number.`);
  }
  return value;
}

export function parseThresholds(env = process.env) {
  return Object.freeze({
    maxJankyFramePercent: positiveOverride(env, 'PERF_MAX_JANK_PERCENT', 10),
    maxOpenConversationP95Ms: positiveOverride(env, 'PERF_MAX_OPEN_P95_MS', 1500),
    maxMemoryGrowthPercent: positiveOverride(
      env,
      'PERF_MAX_MEMORY_GROWTH_PERCENT',
      25,
    ),
    maxCrashes: 0,
    maxWatchdogs: 0,
  });
}

export function evaluatePerformance(metrics, thresholds = parseThresholds({})) {
  const normalized = { ...metrics };
  if (
    Number.isFinite(metrics.memoryBaselineMb) &&
    metrics.memoryBaselineMb > 0 &&
    Number.isFinite(metrics.memoryPeakMb)
  ) {
    normalized.memoryGrowthPercent = Number(
      (((metrics.memoryPeakMb - metrics.memoryBaselineMb) / metrics.memoryBaselineMb) * 100).toFixed(2),
    );
  }
  const failures = [];
  const compareUpper = (metric, limit, label) => {
    const value = normalized[metric];
    if (Number.isFinite(value) && value >= limit) {
      failures.push({ metric, value, limit, message: `${label} must be below ${limit}.` });
    }
  };
  const compareMaximum = (metric, limit, label) => {
    const value = normalized[metric];
    if (Number.isFinite(value) && value > limit) {
      failures.push({ metric, value, limit, message: `${label} must not exceed ${limit}.` });
    }
  };
  compareUpper('jankyFramePercent', thresholds.maxJankyFramePercent, 'Janky frame percent');
  compareUpper(
    'openConversationP95Ms',
    thresholds.maxOpenConversationP95Ms,
    'Conversation open p95',
  );
  compareUpper(
    'memoryGrowthPercent',
    thresholds.maxMemoryGrowthPercent,
    'Memory growth percent',
  );
  compareMaximum('crashes', thresholds.maxCrashes, 'Crash count');
  compareMaximum('watchdogs', thresholds.maxWatchdogs, 'Watchdog count');
  const expected = [
    'jankyFramePercent',
    'openConversationP95Ms',
    'memoryGrowthPercent',
    'crashes',
    'watchdogs',
  ];
  return {
    ...normalized,
    passed: failures.length === 0,
    failures,
    unavailableMetrics: expected.filter((metric) => !Number.isFinite(normalized[metric])),
  };
}

function argsToObject(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('Invalid report arguments.');
    result[key.slice(2)] = value;
  }
  return result;
}

function countMatches(text, pattern) {
  return [...String(text).matchAll(pattern)].length;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const args = argsToObject(argv);
  if (!['android', 'ios'].includes(args.platform)) throw new Error('--platform is required.');
  if (!args.out || !args['run-id'] || !args.device) {
    throw new Error('--out, --run-id, and --device are required.');
  }
  let metrics;
  if (args.platform === 'android') {
    const gfx = parseAndroidGfxInfo(fs.readFileSync(args.gfx, 'utf8'));
    const baseline = parseAndroidMemInfo(fs.readFileSync(args['mem-baseline'], 'utf8'));
    const peak = parseAndroidMemInfo(fs.readFileSync(args['mem-peak'], 'utf8'));
    const events = args.events ? fs.readFileSync(args.events, 'utf8') : '';
    metrics = {
      ...gfx,
      memoryBaselineMb: Number((baseline.totalPssKb / 1024).toFixed(2)),
      memoryPeakMb: Number((peak.totalPssKb / 1024).toFixed(2)),
      crashes: countMatches(events, /FATAL EXCEPTION/gi),
      watchdogs: countMatches(events, /ANR in com\.yiboding\.circleim/gi),
    };
  } else {
    metrics = parseIosMetrics(fs.readFileSync(args['ios-metrics'], 'utf8'));
  }
  if (args['open-p95-ms']) metrics.openConversationP95Ms = Number(args['open-p95-ms']);
  const evaluation = evaluatePerformance(metrics, parseThresholds(env));
  const report = {
    schemaVersion: 1,
    platform: args.platform,
    build: args.build ?? 'unknown',
    device: args.device,
    runId: args['run-id'],
    generatedAt: new Date().toISOString(),
    metrics: evaluation,
  };
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!evaluation.passed) process.exitCode = 1;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
