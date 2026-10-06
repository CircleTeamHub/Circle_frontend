/** One active PUT plus one debounced latest snapshot; superseded jobs are released. */
export function createNoteDraftSaveQueue(delayMs = 650) {
  let queued: { work: () => Promise<boolean>; resolve: (saved: boolean) => void } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active: Promise<void> | null = null;
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };
  const start = () => {
    if (active || !queued) return;
    const job = queued;
    queued = null;
    active = (async () => {
      try { job.resolve(await job.work()); } catch { job.resolve(false); }
    })().finally(() => {
      active = null;
      if (queued && timer === null) start();
    });
  };
  return {
    schedule(work: () => Promise<boolean>): Promise<boolean> {
      queued?.resolve(false);
      clearTimer();
      const result = new Promise<boolean>((resolve) => { queued = { work, resolve }; });
      timer = setTimeout(() => { timer = null; start(); }, delayMs);
      return result;
    },
    async flush(): Promise<void> {
      clearTimer();
      while (active || queued) { start(); if (active) await active; }
    },
    cancel() { clearTimer(); queued?.resolve(false); queued = null; },
  };
}
