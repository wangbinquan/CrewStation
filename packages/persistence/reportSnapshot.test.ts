// RFC-034: source reads and TEMP work must use one real original PG reservation.
import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { connectDatabase } from './connection';
import { originalReportSnapshotSession } from './reportSnapshot';
import type { ReportWorkingPage, ReportWorkspace } from './reportWorkspace';
const available = await testDatabaseAvailable(); let tdb: TestDatabase;
afterEach(async () => { await tdb?.drop(); });
async function original() {
  tdb = await createTestDatabase();
  await tdb.db.execute(sql`CREATE TABLE platform_report_input (id integer PRIMARY KEY,value text NOT NULL)`);
  await tdb.db.execute(sql`INSERT INTO platform_report_input VALUES(1,'before')`);
  return originalReportSnapshotSession(tdb.handle);
}
describe.skipIf(!available)('original report snapshot and private working rows', () => {
  test('retains the original source snapshot across concurrent writes, spills 10001 rows to TEMP, then returns the only reservation', async () => {
    const session = await original(); let retained: ReportWorkspace | undefined;
    const snapshotId = await session.run(async (s) => {
      retained = s.workspace;
      const before = await s.executor.execute(sql`SELECT value FROM platform_report_input WHERE id=1`);
      expect(before[0]!['value']).toBe('before');
      await tdb.db.execute(sql`UPDATE platform_report_input SET value='after' WHERE id=1`);
      const frozen = await s.executor.execute(sql`SELECT value FROM platform_report_input WHERE id=1`);
      expect(frozen[0]!['value']).toBe('before');
      for (let offset=0; offset<10001; offset+=100) await s.workspace.insert('input',Array.from({length:Math.min(100,10001-offset)},(_,i) => ({ key: String(offset+i).padStart(8,'0'), document: { ordinal: String(offset+i), fourBins: ['1','2','3','4'] } })));
      let cursor: string|null = null, ordinal = 0;
      for (;;) {
        const page: ReportWorkingPage<{ordinal:string;fourBins:string[]}> = await s.workspace.page<{ordinal:string;fourBins:string[]}>('input',cursor,137);
        for (const row of page.items) { expect(row.key).toBe(String(ordinal).padStart(8,'0')); expect(row.document).toEqual({ordinal:String(ordinal++),fourBins:['1','2','3','4']}); }
        if (page.nextCursor === null) break; cursor = page.nextCursor;
      }
      expect(ordinal).toBe(10001);
      await s.workspace.put('control',{key:'one',document:{value:'first'}}); await s.workspace.put('control',{key:'one',document:{value:'second'}});
      expect(await s.workspace.get<{value:string}>('control','one')).toEqual({value:'second'}); expect(await s.workspace.get('control','absent')).toBeUndefined();
      await s.workspace.upsert('control',[{key:'one',document:{value:'batch-updated'}},{key:'two',document:{value:'second-row'}}]);
      expect(await s.workspace.get<{value:string}>('control','one')).toEqual({value:'batch-updated'}); expect(await s.workspace.get<{value:string}>('control','two')).toEqual({value:'second-row'});
      await s.workspace.clear('control'); expect(await s.workspace.page('control',null)).toEqual({items:[],nextCursor:null});
      return s.snapshotId;
    });
    await expect(retained!.page('input',null)).rejects.toThrow('closed');
    expect((await tdb.db.execute(sql`SELECT value FROM platform_report_input WHERE id=1`))[0]!['value']).toBe('after');
    const one = connectDatabase(tdb.url,{max:1});
    try {
      const single = originalReportSnapshotSession(one);
      await single.run(async (s) => { expect(s.snapshotId).not.toBe(snapshotId); await s.workspace.insert('one',[{key:'ok',document:1}]); expect(await s.workspace.get<number>('one','ok')).toBe(1); });
      expect((await one.db.execute(sql`SELECT to_regclass('pg_temp.cs_report_workspace') AS table_name`))[0]!['table_name']).toBeNull();
    } finally { await one.close(); }
  },30000);
  test('duplicate/invalid/abort/source-write errors never return a successful report and cleanup allows the next job', async () => {
    const session = await original();
    await expect(session.run(async (s) => { await s.workspace.insert('input',[{key:'same',document:1},{key:'same',document:2}]); })).rejects.toThrow();
    await expect(session.run(async (s) => { await s.executor.execute(sql`UPDATE platform_report_input SET value='forbidden'`); })).rejects.toThrow();
    await expect(session.run(async (s) => { try { await s.executor.execute(sql`UPDATE platform_report_input SET value='swallowed'`); } catch { /* The final original snapshot read must still reject an aborted transaction. */ } return 'not-success'; })).rejects.toThrow();
    await expect(session.run(async (s) => { await s.workspace.insert('input',[{key:'',document:1}]); })).rejects.toThrow('invalid');
    const controller = new AbortController();
    await expect(session.run(async (s) => { await s.workspace.insert('input',[{key:'before-abort',document:1}]); controller.abort(new Error('original report aborted')); await s.workspace.page('input',null); },controller.signal)).rejects.toThrow('aborted');
    await session.run(async (s) => { expect(await s.workspace.page('input',null)).toEqual({items:[],nextCursor:null}); await s.workspace.insert('input',[{key:'new',document:1}]); });
    expect((await tdb.db.execute(sql`SELECT value FROM platform_report_input`))[0]!['value']).toBe('before');
    expect((await tdb.db.execute(sql`SELECT to_regclass('pg_temp.cs_report_workspace') AS table_name`))[0]!['table_name']).toBeNull();
  });
});
