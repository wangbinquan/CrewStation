import type { CompleteWorkingRows } from '../../ports/completeWorkingRows'
import type { UsageContributionEvidence } from '../../domain/completeUsageEvidence'
import { completeUsageGroup } from '../../domain/completeUsageOrder'
/** Original TEMP paths are authoritative; absent prefetch entries are only bounded cache facts. */
export function completeAncestryWorkspace(rows: CompleteWorkingRows, namespace: string, keyOf: (value: string) => string, signal?: AbortSignal) {
  const cache = new Map<string, string | undefined>(),
    pending = new Map<string, string>()
  let writes = 0n
  const remember = (key: string, path: string | undefined) => {
    cache.delete(key)
    cache.set(key, path)
    if (cache.size > 4096) cache.delete(cache.keys().next().value!)
  }
  async function flush() {
    if (!pending.size) return
    await rows.insert(
      namespace,
      [...pending].map(([key, document]) => ({ key, document })),
    )
    pending.clear()
  }
  async function load(keys: readonly string[]) {
    signal?.throwIfAborted()
    const before = writes
    const found = await rows.getMany<string>(namespace, keys)
    signal?.throwIfAborted()
    if (writes !== before) return
    const actual = new Map(found.map((row) => [row.key, row.document]))
    for (const key of keys) if (!pending.has(key) && !cache.has(key)) remember(key, actual.get(key))
  }
  return {
    flush,
    async prefetch(records: readonly UsageContributionEvidence[]) {
      const keys = new Set<string>()
      for (const record of records) {
        const scope = record.measurement.scope
        if (!scope) continue
        const group = completeUsageGroup(record)
        for (const session of [...scope.ancestors, scope.session]) {
          const key = keyOf(JSON.stringify([group, session]))
          if (cache.has(key) || pending.has(key)) continue
          keys.add(key)
          if (keys.size === 500) {
            await load([...keys])
            keys.clear()
          }
        }
      }
      if (keys.size) await load([...keys])
    },
    async bind(group: string, session: string, ancestors: readonly string[]) {
      const key = keyOf(JSON.stringify([group, session])),
        path = JSON.stringify(ancestors)
      let previous = pending.get(key) ?? cache.get(key)
      while (!pending.has(key) && !cache.has(key)) {
        const before = writes
        const retained = await rows.get<string>(namespace, key)
        previous = pending.get(key) ?? cache.get(key)
        if (!pending.has(key) && !cache.has(key) && before !== writes) continue
        if (!pending.has(key) && !cache.has(key)) previous = retained
        break
      }
      if (previous !== undefined && previous !== path) throw new Error('Conflicting observation session ancestry')
      writes++
      if (previous === undefined) pending.set(key, path)
      remember(key, path)
      if (pending.size === 500) await flush()
    },
  }
}
