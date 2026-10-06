/** Bound transport memory while retaining the original iterator order and affirmative EOF. */
export async function* completeUsagePrefetch<T>(records: AsyncIterable<T>, prepare: (batch: readonly T[]) => Promise<void>, signal?: AbortSignal) {
  let batch: T[] = []
  for await (const record of records) {
    signal?.throwIfAborted()
    batch.push(record)
    if (batch.length === 100) {
      await prepare(batch)
      signal?.throwIfAborted()
      yield* batch
      batch = []
    }
  }
  if (batch.length) {
    await prepare(batch)
    signal?.throwIfAborted()
    yield* batch
  }
}
