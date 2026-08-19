const test = require('node:test');
const assert = require('node:assert/strict');

async function loadReport() {
  return import('../scripts/testing/performance-report.mjs');
}

test('Android gfxinfo and meminfo samples are normalized', async () => {
  const { parseAndroidGfxInfo, parseAndroidMemInfo } = await loadReport();
  const gfx = parseAndroidGfxInfo(`
Total frames rendered: 120
Janky frames: 18 (15.00%)
50th percentile: 8ms
90th percentile: 22ms
95th percentile: 31ms
99th percentile: 74ms
Number Missed Vsync: 7
`);
  assert.deepEqual(gfx, {
    totalFrames: 120,
    jankyFrames: 18,
    jankyFramePercent: 15,
    frameP95Ms: 31,
    missedVsync: 7,
  });
  assert.deepEqual(parseAndroidMemInfo('TOTAL PSS: 184320 TOTAL RSS: 260000'), {
    totalPssKb: 184320,
  });
  assert.deepEqual(
    parseAndroidMemInfo(' TOTAL  98304  62000  10000  8000  180000'),
    { totalPssKb: 98304 },
  );
});

test('iOS normalized CSV metrics parse without depending on Xcode XML schema', async () => {
  const { parseIosMetrics } = await loadReport();
  const metrics = parseIosMetrics(`metric,value,unit
janky_frames_percent,8.2,percent
memory_baseline_mb,240,MB
memory_peak_mb,288,MB
open_conversation_p95_ms,1300,ms
crashes,0,count
watchdogs,0,count
`);
  assert.deepEqual(metrics, {
    jankyFramePercent: 8.2,
    memoryBaselineMb: 240,
    memoryPeakMb: 288,
    openConversationP95Ms: 1300,
    crashes: 0,
    watchdogs: 0,
  });
});

test('performance evaluation reports each actionable regression', async () => {
  const { evaluatePerformance } = await loadReport();
  const result = evaluatePerformance({
    jankyFramePercent: 12,
    memoryBaselineMb: 200,
    memoryPeakMb: 270,
    openConversationP95Ms: 1700,
    crashes: 1,
    watchdogs: 0,
  });
  assert.equal(result.passed, false);
  assert.equal(result.memoryGrowthPercent, 35);
  assert.deepEqual(result.failures.map((item) => item.metric), [
    'jankyFramePercent',
    'openConversationP95Ms',
    'memoryGrowthPercent',
    'crashes',
  ]);
});

test('performance evaluation allows explicit positive threshold overrides', async () => {
  const { evaluatePerformance, parseThresholds } = await loadReport();
  const thresholds = parseThresholds({
    PERF_MAX_JANK_PERCENT: '15',
    PERF_MAX_OPEN_P95_MS: '2000',
    PERF_MAX_MEMORY_GROWTH_PERCENT: '40',
  });
  assert.equal(
    evaluatePerformance(
      {
        jankyFramePercent: 12,
        memoryBaselineMb: 200,
        memoryPeakMb: 270,
        openConversationP95Ms: 1700,
        crashes: 0,
        watchdogs: 0,
      },
      thresholds,
    ).passed,
    true,
  );
  assert.throws(() => parseThresholds({ PERF_MAX_JANK_PERCENT: '0' }), /positive/);
});
