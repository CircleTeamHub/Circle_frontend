import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { markWebStartupStage } from './web-startup';

export default function WebScreenReady({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    // Expo 55's async route fallback is null. Navigation wrappers commit before
    // route code arrives, so wait for actual text or a visible page control.
    let ready = false;
    const observer = new MutationObserver(check);
    function check() {
      if (ready || (!node?.textContent?.trim() && !node?.querySelector('input,textarea,img,canvas,svg,[role="progressbar"]'))) return;
      ready = true;
      observer.disconnect();
      markWebStartupStage('page');
    }
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    check();
    return () => observer.disconnect();
  }, []);
  return <div ref={root} style={{ display: 'contents' }}>{children}</div>;
}
