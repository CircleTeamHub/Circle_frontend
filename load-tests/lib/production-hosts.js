/**
 * 「生产在哪」的单一来源。
 *
 * 这个仓库里没有生产域名：app 的端点是构建期由 `EXPO_PUBLIC_API_URL` 注入的，
 * 而那个值来自 GitHub Actions 的仓库变量（见 .github/workflows/android-release.yml
 * 与 daily-android-build.yml）。所以一张手写的域名清单没有任何东西保证它跟真实
 * 部署一致 —— 生产换了 origin、多了个区域域名，清单不会知道，而它恰恰是操作者
 * 把生产误填进自己的 allowlist 时唯一还能拦住的那道闸。
 *
 * 这里改成：清单只当下限，真正的来源是环境本身。
 *
 *   1. KNOWN_PRODUCTION_HOSTS —— 已知的生产域名，只增不减，任何情况下都挡。
 *   2. EXPO_PUBLIC_API_URL / EXPO_PUBLIC_REALTIME_WS_URL —— app 自己的构建变量。
 *      只要环境里有（CI、或本地 source 过 .env 的 shell），它指向哪儿哪儿就是
 *      生产，自动挡掉，零配置、不会漂移。
 *   3. LOAD_PRODUCTION_HOSTS / E2E_PRODUCTION_HOSTS —— 显式补充。CI 应当从与构建
 *      同一个 vars.EXPO_PUBLIC_API_URL 喂进来，让这道闸和真实部署同源。
 *
 * 三者取并集：多一个来源只会更严，不会更松。
 */
export const KNOWN_PRODUCTION_HOSTS = Object.freeze([
  'api.windnote.ai',
  'windnote.ai',
  'www.windnote.ai',
]);

/** 从任意值里取 hostname；拿不到就返回 null（宁可少加，不要加错）。 */
function hostnameOf(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    // 允许直接写裸域名（LOAD_PRODUCTION_HOSTS=api.example.com）。
    return /^[a-z0-9.-]+$/i.test(raw) ? raw.toLowerCase() : null;
  }
}

/**
 * 解析出本次运行必须拒绝的生产域名集合。
 *
 * @param {Record<string, string | undefined>} env 进程/k6 环境变量
 * @param {string} prefix 'LOAD' 或 'E2E'，决定读哪个显式覆盖变量
 */
export function resolveProductionHosts(env = {}, prefix = 'LOAD') {
  const hosts = new Set(KNOWN_PRODUCTION_HOSTS);

  for (const key of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_REALTIME_WS_URL']) {
    const host = hostnameOf(env[key]);
    if (host) hosts.add(host);
  }

  for (const entry of String(env[`${prefix}_PRODUCTION_HOSTS`] ?? '').split(',')) {
    const host = hostnameOf(entry);
    if (host) hosts.add(host);
  }

  return hosts;
}
