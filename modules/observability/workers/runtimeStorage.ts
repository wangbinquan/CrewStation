import type {Logger} from '@crewstation/kernel'
/** Maintenance has its own retry loop. A failed cleanup never stops or acknowledges source work. */
export function runtimeStorageWorker(input: {
  collect: () => Promise<number | {removed:number;scanned:number}>
  sample: () => Promise<void>
  failed: (error: unknown) => Promise<void>
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => () => void
}, logger: Logger) {
  const now = input.now ?? Date.now,
    schedule =
      input.schedule ??
      ((callback, delayMs) => {
        const timer = setTimeout(callback, delayMs)
        return () => clearTimeout(timer)
      })
  let nextSample = 0
  let stopped = false,
    cancel: (() => void) | undefined,
    pending: Promise<void> | undefined
  function tick() {
    if (stopped || pending) return
    cancel = undefined
    const startedAt = now()
    let nextDelay = 60000
    pending = (async () => {
      const result = await input.collect(), active = typeof result === 'number' ? result > 0 : result.removed > 0 || result.scanned > 0
      // Empty sweeps and failures must not turn a quiet database into a write
      // workload. Productive passes yield at least 19x their elapsed time, so
      // catch-up cannot monopolize the database used by foreground requests.
      if (active) nextDelay = Math.max(1000, (now() - startedAt) * 19)
      if (now() >= nextSample) {
        await input.sample()
        nextSample = now() + 60000
      }
    })()
      .catch(async (error) => {
        nextDelay = 60000
        logger.warn('runtime derived storage maintenance awaits retry')
        try {
          await input.failed(error)
        } catch {
          /* Durable state is retried after the database recovers. */
        }
      })
      .finally(() => {
        pending = undefined
        if (!stopped) cancel = schedule(tick, nextDelay)
      })
  }
  return {
    start() {
      if (cancel || pending) return
      stopped = false
      tick()
    },
    async drain() {
      await pending
    },
    async stop() {
      stopped = true
      cancel?.()
      cancel = undefined
      await pending
    },
  }
}
