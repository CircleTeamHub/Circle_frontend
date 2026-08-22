export type GeocoderMessageTarget = {
  postMessage(message: string, targetOrigin: string): void;
};

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'json'>>;

/**
 * Handles only geocoder bridge messages and captures the source window before
 * awaiting fetch. A replaced iframe may reuse requestId=1, so looking up the
 * current ref when the response settles would deliver stale data to a new map.
 */
export function handleWebGeocoderBridgeRequest(options: {
  data: string;
  requestSource: GeocoderMessageTarget;
  geocoderBaseUrl: string | null | undefined;
  fetchImpl?: FetchLike;
}): boolean {
  let request: unknown;
  try {
    request = JSON.parse(options.data) as unknown;
  } catch {
    return false;
  }
  if (
    !request ||
    typeof request !== 'object' ||
    (request as { type?: unknown }).type !== 'geocoder-request'
  ) {
    return false;
  }

  const payload = request as {
    requestId?: unknown;
    path?: unknown;
    params?: unknown;
  };
  const respond = (ok: boolean, data: unknown = null) => {
    // The srcDoc frame intentionally omits allow-same-origin, so its opaque
    // origin cannot be expressed as a targetOrigin. requestSource is the exact
    // WindowProxy captured from the already-validated event source, and this
    // bridge returns only public geocoder data.
    // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
    options.requestSource.postMessage(
      JSON.stringify({
        type: 'geocoder-response',
        requestId: payload.requestId,
        ok,
        data,
      }),
      '*',
    );
  };
  if (
    !options.geocoderBaseUrl ||
    typeof payload.requestId !== 'number' ||
    !Number.isSafeInteger(payload.requestId) ||
    (payload.path !== '/search' && payload.path !== '/reverse') ||
    !payload.params ||
    typeof payload.params !== 'object' ||
    Array.isArray(payload.params)
  ) {
    respond(false);
    return true;
  }

  const geocoderBaseUrl = options.geocoderBaseUrl;
  const requestPath = payload.path;
  const fetchImpl = options.fetchImpl ?? fetch;
  void (async () => {
    try {
      const url = new URL(geocoderBaseUrl + requestPath);
      for (const [key, value] of Object.entries(
        payload.params as Record<string, unknown>,
      )) {
        if (typeof value !== 'string' && typeof value !== 'number') {
          throw new Error('invalid geocoder parameter');
        }
        url.searchParams.set(key, String(value));
      }
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('geocoder request failed');
      respond(true, await response.json());
    } catch {
      respond(false);
    }
  })();
  return true;
}
