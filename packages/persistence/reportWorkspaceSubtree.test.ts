// 2026-10-07: the unchanged 100K Task/10M call qualification timed out
// while per-Task subtree cleanup repeatedly scanned all retained TEMP rows.
import { afterEach, describe, expect, test } from 'bun:test';
import { sql, type SQL } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { originalReportSnapshotSession } from './reportSnapshot';
import { privateReportWorkspace, type ReportWorkingPage, type ReportWorkspace } from './reportWorkspace';

const available = await testDatabaseAvailable(); let tdb: TestDatabase;
afterEach(async () => { await tdb?.drop(); });
function scanNodes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(scanNodes);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [...(typeof record['Node Type'] === 'string' ? [record['Node Type']] : []), ...Object.values(record).flatMap(scanNodes)];
}
describe.skipIf(!available)('original report workspace indexed subtree cleanup', () => {
  test('actual original DELETE visits its namespace index and preserves every sibling and all 6000 retained rows to EOF', async () => {
    tdb = await createTestDatabase(); let retained: ReportWorkspace | undefined;
    await originalReportSnapshotSession(tdb.handle).run(async (snapshot) => {
      retained = snapshot.workspace;
      for (let start=0; start<6000; start+=500) await snapshot.workspace.insert('retained-usage',Array.from({length:500},(_,n)=>({key:String(start+n).padStart(8,'0'),document:{ordinal:start+n}})));
      for (const namespace of ['private-tasks/alpha_100%','private-tasks/中文🌈','private-tasks/slash/','private-tasks/quote\'']) {
        const descendants=[namespace,namespace+'/',namespace+'/a',namespace+'/a/b',namespace+'/é',namespace+'/👨‍💻',namespace+'/0',namespace+'/../literal'];
        const siblings=[namespace+'0',namespace+'00/',namespace+'-',namespace+'é',namespace+'_',namespace+'%','x'+namespace+'/a'];
        for (const name of [...descendants,...siblings]) await snapshot.workspace.insert(name,[{key:'actual',document:{name}}]);
        let plan: unknown;
        const original = new Proxy(snapshot.executor,{get(target,key,receiver){
          if(key==='execute')return async(query:SQL)=>{plan=await target.execute(sql`EXPLAIN (FORMAT JSON) ${query}`);return target.execute(query);};
          return Reflect.get(target,key,receiver);
        }});
        await privateReportWorkspace(original,()=>true).clearTree(namespace);
        // Observe the actual original query, without forced planner settings.
        expect(scanNodes(plan)).not.toContain('Seq Scan');
        expect(JSON.stringify(plan)).toContain('cs_report_workspace_pkey');
        for(const name of descendants)expect(await snapshot.workspace.page(name,null,1)).toEqual({items:[],nextCursor:null});
        for(const name of siblings)expect(await snapshot.workspace.page(name,null,1)).toEqual({items:[{key:'actual',document:{name}}],nextCursor:null});
      }
      let cursor:string|null=null,ordinal=0;
      for(;;){
        const page:ReportWorkingPage<{ordinal:number}>=await snapshot.workspace.page('retained-usage',cursor,137);
        for(const row of page.items){expect(row.key).toBe(String(ordinal).padStart(8,'0'));expect(row.document).toEqual({ordinal:ordinal++});}
        if(page.nextCursor===null)break;cursor=page.nextCursor;
      }
      expect(ordinal).toBe(6000);
    });
    await expect(retained!.clearTree('retained-usage')).rejects.toThrow('closed');
  },30_000);
  test('empty, inactive and original aborted cleanup cannot delete retained rows', async () => {
    tdb=await createTestDatabase();
    await originalReportSnapshotSession(tdb.handle).run(async(snapshot)=>{
      await snapshot.workspace.put('retained-usage',{key:'original',document:{value:'kept'}});
      await expect(snapshot.workspace.clearTree('')).rejects.toThrow('empty');
      await expect(privateReportWorkspace(snapshot.executor,()=>false).clearTree('retained-usage')).rejects.toThrow('closed');
      const controller=new AbortController();controller.abort(new Error('original cleanup aborted'));
      await expect(privateReportWorkspace(snapshot.executor,()=>true,controller.signal).clearTree('retained-usage')).rejects.toThrow('original cleanup aborted');
      await snapshot.workspace.clearTree('absent');
      expect(await snapshot.workspace.page('retained-usage',null,1)).toEqual({items:[{key:'original',document:{value:'kept'}}],nextCursor:null});
    });
  });
});
