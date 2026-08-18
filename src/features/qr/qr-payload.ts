/**
 * 二维码载荷:统一编码成深链 `windnoteai://qr?t=<token>`。
 * 外部系统相机扫到会唤起 App(scheme 已注册),App 内扫码器解析后直跳落地页;
 * 未来域名上线后 `https://windnote.ai/qr?t=` 同样能解析(此处已兼容)。
 *
 * 常量与 constants/branding.ts 保持一致 —— 本文件被 node --test 直测,
 * 按 .mts 测试惯例运行时零依赖(只内联,不 import 值);
 * test/qr-feature.test.js 里有源码断言锁两边不漂移。
 *
 * 解析不依赖 URL/URLSearchParams(RN 运行时 searchParams 支持不齐),手工拆串。
 */
const APP_DEEP_LINK_SCHEMES = ['windnoteai', 'circleim'] as const;
const APP_UNIVERSAL_LINK_HOSTS = [
  'windnote.ai',
  'www.windnote.ai',
  'circle.im',
  'www.circle.im',
] as const;

// 服务端 randomBytes(24).toString('base64url') → 32 字符;放宽到 16-128 兼容轮换策略调整。
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const SCHEME_PREFIXES = APP_DEEP_LINK_SCHEMES.map((scheme) => `${scheme}://`);

/**
 * 归一化「对端投喂的令牌字段」:接受裸令牌,也接受整条本站二维码深链
 * (发送端实现换了形态时不至于炸);其余一律 null。
 *
 * 二维码卡片的载荷来自聊天对端,不能直接信。这里收口成「要么是一个形状合法的
 * 令牌,要么什么都不是」—— 本端后续只会拿它去拼自家的 /qr 深链,
 * 对端因此没有任何机会决定「点这张卡会打开什么」。
 */
export function normalizeQrToken(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (TOKEN_PATTERN.test(value)) return value;
  return parseQrToken(value);
}

export function buildQrUrl(token: string): string {
  return `${SCHEME_PREFIXES[0]}qr?t=${encodeURIComponent(token)}`;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function extractToken(rest: string): string | null {
  // rest 形如 `qr?t=<token>`、`qr/<token>` 或(https 下)`qr?t=..#..`。
  if (!rest.startsWith('qr')) return null;
  const after = rest.slice(2);

  let candidate: string | null = null;
  if (after.startsWith('?')) {
    for (const pair of after.slice(1).split('#')[0].split('&')) {
      const eq = pair.indexOf('=');
      if (eq > 0 && pair.slice(0, eq) === 't') {
        candidate = safeDecodeURIComponent(pair.slice(eq + 1));
        break;
      }
    }
  } else if (after.startsWith('/')) {
    candidate = safeDecodeURIComponent(after.slice(1).split(/[?#]/)[0]);
  }

  return candidate && TOKEN_PATTERN.test(candidate) ? candidate : null;
}

/** 从任意扫码文本中提取二维码令牌;不是本应用的 QR 载荷时返回 null。 */
export function parseQrToken(raw: string): string | null {
  const value = raw.trim();

  for (const prefix of SCHEME_PREFIXES) {
    if (value.startsWith(prefix)) {
      return extractToken(value.slice(prefix.length));
    }
  }

  if (value.startsWith('https://')) {
    const withoutProtocol = value.slice('https://'.length);
    const slash = withoutProtocol.indexOf('/');
    if (slash < 0) return null;
    const host = withoutProtocol.slice(0, slash).toLowerCase();
    if (!(APP_UNIVERSAL_LINK_HOSTS as readonly string[]).includes(host)) {
      return null;
    }
    return extractToken(withoutProtocol.slice(slash + 1));
  }

  return null;
}
