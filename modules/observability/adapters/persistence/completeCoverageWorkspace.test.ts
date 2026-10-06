import { expect, test } from 'bun:test';
import type { CompleteWorkingRows, CompleteWorkingRow } from '../../ports/completeWorkingRows';
import { completeCoverageWorkspace } from './completeCoverageWorkspace';

function originalRows() {
  const spaces = new Map<string,Map<string,unknown>>(), reads = { pages: 0, points: 0 };
  const space = (name:string) => { let rows = spaces.get(name); if (!rows) { rows = new Map(); spaces.set(name,rows); } return rows; };
  const save = (name:string,items:readonly CompleteWorkingRow[]) => { for (const item of items) space(name).set(item.key,item.document); };
  const rows:CompleteWorkingRows = {
    async insert(name,items) { save(name,items); }, async put(name,item) { save(name,[item]); }, async upsert(name,items) { save(name,items); },
    async get<T>(name:string,key:string) { reads.points++; return space(name).get(key) as T|undefined; },
    async getMany<T>(name:string,keys:readonly string[]) { return keys.flatMap(key=>space(name).has(key)?[{key,document:space(name).get(key) as T}]:[]); },
    async page<T>(name:string,after:string|null,size=100) {
      reads.pages++; const all=[...space(name)].filter(([key])=>after===null||key>after).sort(([a],[b])=>a.localeCompare(b));
      const selected=all.slice(0,size).map(([key,document])=>({key,document:document as T}));
      return {items:selected,nextCursor:all.length>size?selected.at(-1)!.key:null};
    },
    async clear(name) { spaces.delete(name); }, async clearTree(name) { for (const key of spaces.keys()) if(key===name||key.startsWith(name+'/'))spaces.delete(key); },
  };
  return { rows, reads, space };
}

test('original empty TEMP EOF removes repeated missing-root reads without limiting request identities',async()=>{
  const original=originalRows(), workspace=completeCoverageWorkspace(original.rows,'original-coverage',value=>value);
  // The unchanged 201/1001 Task regression timed out on point reads for request-only populations.
  for(let n=0;n<10001;n++)expect(await workspace.coverage.root('original-tree-'+n)).toBeNull();
  expect(original.reads).toEqual({pages:1,points:1});
  await workspace.coverage.setRoot('original-tree-0','actual-interval'); await workspace.flush();
  expect(await workspace.coverage.root('original-tree-0')).toBe('actual-interval');
  for(let n=1;n<5001;n++)expect(await workspace.coverage.root('later-tree-'+n)).toBeNull();
  expect(await workspace.coverage.root('original-tree-0')).toBe('actual-interval');
  expect(original.reads.points).toBe(5002);
});

test('a nonempty original relation is read rather than treated as a fresh empty workspace',async()=>{
  const original=originalRows();original.space('original-coverage/roots').set('retained-tree',{tree:'retained-tree',id:'retained-node'});
  const workspace=completeCoverageWorkspace(original.rows,'original-coverage',value=>value);
  expect(await workspace.coverage.root('retained-tree')).toBe('retained-node');
  expect(await workspace.coverage.root('other-tree')).toBeNull();
  expect(original.reads).toEqual({pages:1,points:2});
});

test('a root write while the original empty read is pending invalidates that proof before cache eviction',async()=>{
  const original=originalRows(), originalPage=original.rows.page.bind(original.rows);
  let release!:()=>void, entered!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;}), began=new Promise<void>(resolve=>{entered=resolve;});
  original.rows.page=async()=>{entered();await pending;return {items:[],nextCursor:null};};
  const workspace=completeCoverageWorkspace(original.rows,'original-coverage',value=>value), missing=workspace.coverage.root('actual-root');
  await began;await workspace.coverage.setRoot('actual-root','actual-node');release();expect(await missing).toBe('actual-node');
  original.rows.page=originalPage;await workspace.flush();
  for(let n=0;n<5001;n++)expect(await workspace.coverage.root('unrelated-'+n)).toBeNull();
  expect(await workspace.coverage.root('actual-root')).toBe('actual-node');
  expect(original.reads.points).toBe(5002);
});
