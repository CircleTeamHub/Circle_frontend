/* eslint-disable no-var -- This function is serialized into HTML before Metro and must use ES5 syntax. */
// No imports or SDK may be required to run this probe.
module.exports = function installWebStartup(win, doc, config) {
  var startedAt = Date.now();
  var pageReady = false;
  var sdkReady = false;
  var report = null;
  var timer;
  var loaded = {};
  var storageKey = 'circle-im-web-startup-diagnostics-v1';
  var titles = {
    scriptLoadFailed: '网页启动失败：程序文件下载失败',
    scriptEvaluationFailed: '网页启动失败：程序执行异常',
    startupTimeout: '网页启动失败：超过一分钟仍未显示页面'
  };

  function save() {
    try { win.localStorage.setItem(storageKey, JSON.stringify(report)); } catch (_) { /* Private mode must still show the in-memory report. */ }
  }

  function show() {
    if (pageReady || !doc.body) return;
    var panel = doc.getElementById('windnote-startup-diagnostic');
    if (!panel) {
      panel = doc.createElement('section');
      panel.id = 'windnote-startup-diagnostic';
      panel.setAttribute('role', 'status');
      panel.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;padding:16px;background:#fff;color:#222;border:1px solid #aaa;border-radius:12px;font:16px sans-serif;max-height:70vh;overflow:auto';
      var message = doc.createElement('p');
      message.textContent = '页面加载未完成。请刷新重试；若仍失败，可复制下面的诊断信息发给客服。';
      panel.appendChild(message);
      var details = doc.createElement('textarea');
      details.id = 'windnote-startup-report';
      details.readOnly = true;
      details.rows = 7;
      details.setAttribute('aria-label', '网页加载诊断信息');
      details.style.cssText = 'width:100%;box-sizing:border-box;font-size:16px';
      panel.appendChild(details);
      var retry = doc.createElement('button');
      retry.textContent = '刷新页面';
      retry.style.cssText = 'min-height:44px;margin-top:8px;font-size:16px';
      retry.onclick = function () { win.location.reload(); };
      panel.appendChild(retry);
      doc.body.appendChild(panel);
    }
    panel.children[1].value = JSON.stringify(report);
  }

  function resources() {
    var entries = win.performance && win.performance.getEntriesByType ? win.performance.getEntriesByType('resource') : [];
    return config.assets.map(function (asset) {
      var result = { asset: asset, loaded: loaded[asset] === true };
      for (var i = 0; i < entries.length; i++) {
        var name = entries[i].name.split('?')[0].split('/').pop();
        if (name !== asset) continue;
        result.durationMs = Math.round(entries[i].duration);
        result.bytes = entries[i].encodedBodySize || 0;
        if (/^(h2|h3|http\/1\.1)$/.test(entries[i].nextHopProtocol)) result.protocol = entries[i].nextHopProtocol;
      }
      return result;
    });
  }

  function fail(kind, asset) {
    if (pageReady || report) return;
    win.clearTimeout(timer);
    var id = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, function () { return Math.floor(Math.random() * 16).toString(16); });
    report = {
      id: id, at: Date.now(), kind: kind, build: config.build, asset: asset || null,
      elapsedMs: Math.max(0, Date.now() - startedAt), sentryReady: sdkReady,
      browserOS: /iPhone|iPad|iPod/.test(win.navigator.userAgent) ? 'ios' : /Android/.test(win.navigator.userAgent) ? 'android' : 'other',
      online: win.navigator.onLine !== false, resources: resources(), delivery: config.endpoint ? 'pending' : 'unconfigured'
    };
    save();
    show();
    if (!config.endpoint || !win.fetch) return;
    var event = {
      event_id: id, timestamp: report.at / 1000, platform: 'javascript', level: 'error',
      environment: config.environment,
      exception: { values: [{ type: 'WebStartupError', value: titles[kind] }] },
      fingerprint: ['web-startup', kind],
      tags: { operation: 'webStartup', kind: kind, platform: 'web' },
      extra: { startup: report }
    };
    var controller = win.AbortController ? new win.AbortController() : null;
    var settled = false;
    var sendTimer = win.setTimeout(function () {
      if (controller) controller.abort();
      finish('failed');
    }, 8000);
    function finish(delivery) {
      if (settled) return;
      settled = true;
      win.clearTimeout(sendTimer);
      report.delivery = delivery;
      save();
      show();
    }
    try {
      win.fetch(config.endpoint, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ event_id: id }) + '\n' + JSON.stringify({ type: 'event' }) + '\n' + JSON.stringify(event) + '\n',
        signal: controller ? controller.signal : undefined
      }).then(function (response) { finish(response.ok ? 'sent' : 'failed'); }, function () { finish('failed'); });
    } catch (_) { finish('failed'); }
  }

  function scriptAsset(event) {
    var target = event.target;
    if (!target || target.tagName !== 'SCRIPT' || !target.src) return null;
    var asset = target.src.split('?')[0].split('/').pop();
    return config.assets.indexOf(asset) >= 0 ? asset : null;
  }
  function onError(event) {
    var asset = scriptAsset(event);
    if (asset) fail('scriptLoadFailed', asset);
    else if (!event.target || event.target === win) fail('scriptEvaluationFailed');
  }
  function onLoad(event) { var asset = scriptAsset(event); if (asset) loaded[asset] = true; }
  function onRejection() { fail('scriptEvaluationFailed'); }
  function arm() {
    win.clearTimeout(timer);
    if (!pageReady && !report && !doc.hidden) timer = win.setTimeout(function () { fail('startupTimeout'); }, 60000);
  }

  win.__WINDNOTE_WEB_STARTUP__ = {
    sentryReady: function () { sdkReady = true; },
    ready: function () {
      pageReady = true;
      win.clearTimeout(timer);
      win.removeEventListener('error', onError, true);
      win.removeEventListener('load', onLoad, true);
      win.removeEventListener('unhandledrejection', onRejection);
      doc.removeEventListener('visibilitychange', arm);
      var panel = doc.getElementById('windnote-startup-diagnostic');
      if (panel) panel.remove();
    }
  };
  win.addEventListener('error', onError, true);
  win.addEventListener('load', onLoad, true);
  win.addEventListener('unhandledrejection', onRejection);
  doc.addEventListener('visibilitychange', arm);
  arm();
};
