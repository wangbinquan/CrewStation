import { completeExternalSort } from '../application/completeExternalSort';
// RFC-034: spill beyond all previous caps; reconcile every original allocation and bucket.
import { describe, expect, test } from 'bun:test'
import { completeUsageWorkspace } from '../adapters/persistence/completeUsageWorkspace'
import { completeCoverageWorkspace } from '../adapters/persistence/completeCoverageWorkspace'
import { selectCompleteUsage } from '../application/completeUsageSelection'
import { coveragePrefixMaximum, insertCoverageInterval } from '../domain/coverageIntervalIndex'
import type { UsageContributionEvidence } from '../domain/completeUsageEvidence'
import type { CompleteWorkingRows, CompleteWorkingPage } from '../ports/completeWorkingRows'
function workingRows() {
  const spaces = new Map<string,Map<string,unknown>>()
  let maxBatch = 0
  const rows = (space:string) => { let found = spaces.get(space); if (!found) { found = new Map(); spaces.set(space,found) } return found }
  const storage: CompleteWorkingRows = {
    async insert(space, items) {
      maxBatch = Math.max(maxBatch,items.length)
      const target = rows(space), keys = new Set<string>()
      for (const row of items) { if (keys.has(row.key) || target.has(row.key)) throw new Error('duplicate original row'); keys.add(row.key) }
      for (const row of items) target.set(row.key,structuredClone(row.document))
    },
    async upsert(space,items) { maxBatch = Math.max(maxBatch,items.length); for (const row of items) rows(space).set(row.key,structuredClone(row.document)) },
    async put(space,item) { rows(space).set(item.key,structuredClone(item.document)) },
    async get<T>(space:string,key:string) { return structuredClone(rows(space).get(key)) as T|undefined },
    async getMany<T>(space:string,keys:readonly string[]) { return keys.flatMap(key=>rows(space).has(key)?[{key,document:structuredClone(rows(space).get(key)) as T}]:[]) },
    async page<T>(space:string,after:string|null,size=100) {
      const selected = [...rows(space)].filter(([key]) => after === null || key>after).sort(([a],[b]) => a<b ? -1 : a>b ? 1 : 0).slice(0,size+1)
      const items = selected.slice(0,size).map(([key,document]) => ({key,document:structuredClone(document) as T}))
      return {items,nextCursor:selected.length>size ? items.at(-1)!.key : null}
    },
    async clear(space) { spaces.delete(space) },
    async clearTree(namespace:string) { for(const key of spaces.keys())if(key===namespace||key.startsWith(namespace+'/'))spaces.delete(key); },
  }
  return {storage,spaces,maxBatch:() => maxBatch}
}
function record(n:number): UsageContributionEvidence {
  return {sourceId:'original',measurement:{invocationId:'call',recordId:`原记录-${n}`,model:null,scope:undefined},contribution:{input:String(n+1),cacheRead:'3',cacheWrite:'5',output:'7'},complete:true}
}
const identity = (r:UsageContributionEvidence) => JSON.stringify([r.sourceId,r.measurement.invocationId,r.measurement.recordId])
async function drain<T>(rows:CompleteWorkingRows,space:string) {
  const all:T[] = []; let after:string|null = null
  for (;;) { const page: CompleteWorkingPage<T> = await rows.page<T>(space,after,137); all.push(...page.items.map((r) => r.document)); if (page.nextCursor === null) return all; after = page.nextCursor }
}
describe('full retained usage workspace', () => {
  test('10001 inputs and allocations retain every original identity and four buckets with bounded batches', async () => {
    const backing = workingRows(), input = Array.from({length:10001},(_,n) => record(n))
    const usage = completeUsageWorkspace({order:completeExternalSort,rows:backing.storage,namespace:'full',keyOf:(s) => s,identity})
    for (let offset=0;offset<input.length;offset+=1000) await usage.append(input.slice(offset,offset+1000))
    usage.seal('10001'); const total = await selectCompleteUsage(usage.workspace); await usage.flush()
    const allocations = await drain<{record:UsageContributionEvidence;contribution:UsageContributionEvidence['contribution']}>(backing.storage,usage.allocationsNamespace)
    expect(allocations.map((a) => identity(a.record)).sort()).toEqual(input.map(identity).sort())
    for (const a of allocations) expect(a.contribution).toEqual(a.record.contribution)
    expect(total.selected).toBe('10001'); expect(total.excluded).toBe('0'); expect(total.allSelectedComplete).toBe(true)
    expect(total.tokens).toEqual({input:String(10001n*10002n/2n),cacheRead:'30003',cacheWrite:'50005',output:'70007'})
    expect(backing.maxBatch()).toBeLessThanOrEqual(500)
  },30000)
  test('cache eviction cannot erase original ancestry or selected coverage', async () => {
    const backing = workingRows(), usage = completeUsageWorkspace({order:completeExternalSort,rows:backing.storage,namespace:'ancestor',keyOf:(s) => s,identity})
    for (let n=0;n<10001;n++) await usage.workspace.bindAncestry('group',`session-${n}`,[`root-${n}`])
    await usage.flush()
    await expect(usage.workspace.bindAncestry('group','session-0',['different-root'])).rejects.toThrow('Conflicting')
    const coverage = completeCoverageWorkspace(backing.storage,'coverage',(s) => s)
    for (let n=0;n<10001;n++) await insertCoverageInterval(coverage.coverage,`tree-${n}`,{start:n*2,end:n*2+1})
    await coverage.flush()
    const reloaded = completeCoverageWorkspace(backing.storage,'coverage',(s) => s)
    for (const n of [0,1,4095,4096,5000,10000]) expect(await coveragePrefixMaximum(reloaded.coverage,`tree-${n}`,n*2)).toBe(n*2+1)
    expect(backing.maxBatch()).toBeLessThanOrEqual(500)
  },30000)
  test('empty coverage roots are cached, and a later original summary replaces the cached absence',async()=>{
    const backing=workingRows();let reads=0;
    const rows:CompleteWorkingRows={...backing.storage,get:async<T>(space:string,key:string)=>{reads++;return backing.storage.get<T>(space,key);}};
    const coverage=completeCoverageWorkspace(rows,'absence',(s)=>s);
    for(let n=0;n<10001;n++) expect(await coveragePrefixMaximum(coverage.coverage,'original-tree',n)).toBe(null);
    expect(reads).toBe(1);
    await insertCoverageInterval(coverage.coverage,'original-tree',{start:1,end:10001});
    expect(await coveragePrefixMaximum(coverage.coverage,'original-tree',10001)).toBe(10001);
    await coverage.flush();
    const reloaded=completeCoverageWorkspace(backing.storage,'absence',(s)=>s);
    expect(await coveragePrefixMaximum(reloaded.coverage,'original-tree',10001)).toBe(10001);
  });
  test('unsealed, duplicate, mismatched EOF, missing ordinals and interrupted input cannot become complete', async () => {
    const backing = workingRows(), usage = completeUsageWorkspace({order:completeExternalSort,rows:backing.storage,namespace:'bad',keyOf:(s) => s,identity})
    await expect(selectCompleteUsage(usage.workspace)).rejects.toThrow('not sealed')
    await usage.append([record(0)]); expect(() => usage.seal('2')).toThrow('EOF')
    await expect(usage.append([record(0)])).rejects.toThrow('duplicate')
    usage.seal('1'); await expect(usage.append([record(1)])).rejects.toThrow('sealed')
    backing.spaces.get('bad/input')!.clear()
    await expect(selectCompleteUsage(usage.workspace)).rejects.toThrow('row count')
    const controller = new AbortController(), interrupted = completeUsageWorkspace({order:completeExternalSort,rows:backing.storage,namespace:'abort',keyOf:(s) => s,identity,signal:controller.signal})
    controller.abort(new Error('source cancelled')); await expect(interrupted.append([record(0)])).rejects.toThrow('cancelled')
  })
})
