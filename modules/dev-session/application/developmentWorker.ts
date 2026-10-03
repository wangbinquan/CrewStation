/** Retain the complete scheduler iteration, including source reads before the first original callback is born. */
export function developmentWorker(tick: () => Promise<unknown>, milliseconds: number, drain: () => Promise<void>, failed: (error: unknown) => void) {
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
  const once = () => running ??= Promise.resolve().then(tick).then(() => {}, failed).finally(() => { running = undefined; });
  return { start: () => { timer ??= setInterval(() => { void once(); }, milliseconds); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await running; await drain(); } };
}
