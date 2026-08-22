param(
  [string]$Suite = $(if ($env:PERF_SUITE) { $env:PERF_SUITE } else { 'conversation-list-scroll' })
)

$ErrorActionPreference = 'Stop'
$AppId = 'com.yiboding.circleim'
$Adb = if ($env:ADB_BIN) { $env:ADB_BIN } else { 'adb' }

function Require-Environment([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$Name is required."
  }
  return $value.Trim()
}

$runId = Require-Environment 'E2E_RUN_ID'
$resultInput = Require-Environment 'PERF_RESULTS_DIR'
$resultDir = if ([IO.Path]::IsPathRooted($resultInput)) {
  [IO.Path]::GetFullPath($resultInput)
} else {
  [IO.Path]::GetFullPath((Join-Path (Get-Location) $resultInput))
}
if ([IO.Path]::GetPathRoot($resultDir) -eq $resultDir) {
  throw 'PERF_RESULTS_DIR must not be a filesystem root.'
}
New-Item -ItemType Directory -Force -Path $resultDir | Out-Null

$deviceLines = & $Adb devices
if ($LASTEXITCODE -ne 0) { throw 'adb devices failed.' }
$devices = @(
  $deviceLines |
    Select-String '^([^\s]+)\s+device(?:\s|$)' |
    ForEach-Object { $_.Matches[0].Groups[1].Value }
)
$selected = if ($env:PERF_DEVICE_ID) { $env:PERF_DEVICE_ID.Trim() } else { $null }
if ($selected) {
  if ($devices -notcontains $selected) { throw "PERF_DEVICE_ID $selected is not connected." }
} elseif ($devices.Count -ne 1) {
  throw 'Connect exactly one adb device or set PERF_DEVICE_ID.'
} else {
  $selected = $devices[0]
}

function Invoke-Adb([string[]]$Arguments) {
  $output = & $Adb -s $selected @Arguments
  if ($LASTEXITCODE -ne 0) { throw "adb command failed: $($Arguments -join ' ')" }
  return ($output -join "`n")
}

$baselinePath = Join-Path $resultDir 'android-meminfo-baseline.txt'
$peakPath = Join-Path $resultDir 'android-meminfo-post.txt'
$gfxPath = Join-Path $resultDir 'android-gfxinfo.txt'
$eventsPath = Join-Path $resultDir 'android-logcat.txt'
$reportPath = Join-Path $resultDir 'performance-report.json'
$tracePath = Join-Path $resultDir 'android-ui.perfetto-trace'
$deviceTrace = "/data/misc/perfetto-traces/windnote-$runId.perfetto-trace"

Invoke-Adb @('shell', 'dumpsys', 'meminfo', $AppId) | Set-Content -LiteralPath $baselinePath
Invoke-Adb @('shell', 'dumpsys', 'gfxinfo', $AppId, 'reset') | Out-Null
Invoke-Adb @('logcat', '-c') | Out-Null

$perfettoProcess = $null
if ($env:PERF_CAPTURE_PERFETTO -eq 'true') {
  $duration = if ($env:PERF_TRACE_DURATION_SECONDS) { [int]$env:PERF_TRACE_DURATION_SECONDS } else { 60 }
  if ($duration -lt 10 -or $duration -gt 600) { throw 'PERF_TRACE_DURATION_SECONDS must be 10-600.' }
  $perfettoArgs = @(
    '-s', $selected, 'shell', 'perfetto', '-o', $deviceTrace,
    '-t', "${duration}s", 'sched', 'freq', 'idle', 'am', 'wm', 'gfx', 'view',
    'binder_driver', 'hal', 'dalvik'
  )
  $perfettoProcess = Start-Process -FilePath $Adb -ArgumentList $perfettoArgs -PassThru -WindowStyle Hidden
}

try {
  $env:MAESTRO_DEVICE_ID = $selected
  & node scripts/run-e2e.mjs $Suite
  if ($LASTEXITCODE -ne 0) { throw "Maestro performance suite $Suite failed." }
} finally {
  if ($perfettoProcess) {
    Wait-Process -Id $perfettoProcess.Id -Timeout 620 -ErrorAction SilentlyContinue
    & $Adb -s $selected pull $deviceTrace $tracePath | Out-Null
    & $Adb -s $selected shell rm $deviceTrace | Out-Null
  }
}

Invoke-Adb @('shell', 'dumpsys', 'gfxinfo', $AppId) | Set-Content -LiteralPath $gfxPath
Invoke-Adb @('shell', 'dumpsys', 'meminfo', $AppId) | Set-Content -LiteralPath $peakPath
Invoke-Adb @('logcat', '-d', '-v', 'threadtime') | Set-Content -LiteralPath $eventsPath
$deviceName = Invoke-Adb @('shell', 'getprop', 'ro.product.model')

$reportArgs = @(
  'scripts/testing/performance-report.mjs',
  '--platform', 'android',
  '--gfx', $gfxPath,
  '--mem-baseline', $baselinePath,
  '--mem-peak', $peakPath,
  '--events', $eventsPath,
  '--out', $reportPath,
  '--run-id', $runId,
  '--device', "$selected ($deviceName)",
  '--build', $(if ($env:PERF_BUILD_ID) { $env:PERF_BUILD_ID } else { 'local-release' })
)
if ($env:PERF_OPEN_P95_MS) {
  $reportArgs += @('--open-p95-ms', $env:PERF_OPEN_P95_MS)
}
& node @reportArgs
if ($LASTEXITCODE -ne 0) { throw 'Android UI performance thresholds failed.' }
