import { useIsFocused } from '@react-navigation/native';
import { useEffect } from 'react';

import { useAuthStore } from '@/stores/authStore';

const EXPORTED_SCRIPT = /^\/_expo\/static\/js\/web\/[\w.+()[\]-]+-[a-f0-9]{32}\.js$/i;
const INITIAL_DELAY_MS = 1500;
const NEXT_ASSET_DELAY_MS = 250;
const LOAD_TIMEOUT_MS = 30_000;

function readAssets(): string[] {
  const metadata = document.getElementById('windnote-web-prefetch-assets');
  if (metadata?.getAttribute('type') !== 'application/json' || !metadata.textContent) {
    return [];
  }

  try {
    const assets: unknown = JSON.parse(metadata.textContent);
    if (Array.isArray(assets)) {
      const paths = assets.filter(
        (asset): asset is string => typeof asset === 'string' && EXPORTED_SCRIPT.test(asset)
      );
      return [...new Set(paths)].map((path) => location.origin + path);
    }
  } catch {
    // Optional export metadata can be ignored if malformed.
  }
  return [];
}

export default function WebRoutePrefetch() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const webSessionInvalidated = useAuthStore((state) => state.webSessionInvalidated);
  const onboardingRequired = useAuthStore((state) => state.onboardingRequired);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (
      !isAuthenticated ||
      isLoading ||
      webSessionInvalidated ||
      onboardingRequired ||
      !isFocused ||
      typeof document === 'undefined'
    ) {
      return;
    }

    const assets = readAssets();
    if (assets.length === 0) return;

    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection;
    const canPreload = () => document.visibilityState === 'visible' && !connection?.saveData;
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingLink: HTMLLinkElement | undefined;

    function releasePendingLink(keep: boolean) {
      if (!pendingLink) return;
      pendingLink.onload = null;
      pendingLink.onerror = null;
      if (!keep) pendingLink.remove();
      pendingLink = undefined;
    }

    function preloadNext() {
      if (!canPreload()) return;

      const scriptPreloads = document.head.querySelectorAll<HTMLLinkElement>(
        'link[rel="preload"][as="script"]'
      );
      const preloadedHrefs = new Set(Array.from(scriptPreloads, (link) => link.href));

      while (index < assets.length) {
        const href = assets[index];
        if (
          preloadedHrefs.has(href) ||
          performance.getEntriesByName(href, 'resource').length > 0
        ) {
          index++;
          continue;
        }

        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'script';
        link.href = href;
        link.setAttribute('fetchpriority', 'low');
        pendingLink = link;

        function finish(loaded: boolean) {
          clearTimeout(timer);
          releasePendingLink(loaded);
          index++;
          if (index < assets.length && canPreload()) {
            timer = setTimeout(preloadNext, NEXT_ASSET_DELAY_MS);
          }
        }

        link.onload = () => finish(true);
        link.onerror = () => finish(false);
        timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
        document.head.append(link);
        return;
      }
    }

    function stop() {
      clearTimeout(timer);
      releasePendingLink(false);
    }

    function updateVisibility() {
      stop();
      if (index < assets.length && canPreload()) {
        timer = setTimeout(preloadNext, INITIAL_DELAY_MS);
      }
    }

    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      stop();
    };
  }, [isAuthenticated, isLoading, webSessionInvalidated, onboardingRequired, isFocused]);

  return null;
}
