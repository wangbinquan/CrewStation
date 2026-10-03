// Original PG statement receipts; original 5 second concurrency budget is preserved.
import {afterEach,describe,test,expect} from 'bun:test';
import {runMigrations} from '@crewstation/persistence';
import {sql} from 'drizzle-orm';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {observabilityMigrations} from '../wiring';
import {originalRuntimeReportIdentity} from '../adapters/persistence/reports/reportStore';
const available=await testDatabaseAvailable();let database:TestDatabase|undefined;
afterEach(async()=>{await database?.drop();database=undefined;});
async function fixture(){const f=await createTestDatabase([observabilityMigrations]);database=f;await f.db.execute(sql`CREATE TABLE original_clock_facts(project text PRIMARY KEY)`);await f.db.execute(sql`CREATE TRIGGER original_clock AFTER INSERT ON original_clock_facts FOR EACH STATEMENT EXECUTE FUNCTION observability.advance_runtime_report_clock()`);return f;}
describe.skipIf(!available)('original non-blocking committed report clock',()=>{
 test('upgrade preserves the exact old singleton anchor, starts new receipts at zero and never copies or drops original facts',async()=>{
  const previous={...observabilityMigrations,files:observabilityMigrations.files.filter(file=>file.name.localeCompare('0017_')<0)},f=await createTestDatabase([previous]);database=f;
  await f.db.execute(sql`CREATE TABLE original_clock_facts(project text PRIMARY KEY)`);await f.db.execute(sql`CREATE TRIGGER original_clock AFTER INSERT ON original_clock_facts FOR EACH STATEMENT EXECUTE FUNCTION observability.advance_runtime_report_clock()`);
  await f.db.execute(sql`INSERT INTO original_clock_facts VALUES('old-A')`);await f.db.execute(sql`INSERT INTO original_clock_facts VALUES('old-B')`);
  const [before]=await f.db.execute<{revision:string}>(sql`SELECT revision::text FROM observability.runtime_report_clock WHERE singleton=true`);expect(before!.revision).toBe('2');
  await runMigrations(f.db,[observabilityMigrations]);expect((await f.db.execute<{revision:string}>(sql`SELECT revision::text FROM observability.runtime_report_clock WHERE singleton=true`))[0]).toEqual(before!);expect((await f.db.execute(sql`SELECT count(*)::text AS count FROM observability.runtime_report_revisions`))[0]!['count']).toBe('0');expect((await originalRuntimeReportIdentity(f.db)).revision).toBe(before!.revision);
  await f.db.execute(sql`INSERT INTO original_clock_facts VALUES('new-C')`);expect((await originalRuntimeReportIdentity(f.db)).revision).toBe('3');expect((await f.db.execute<{revision:string}>(sql`SELECT revision::text FROM observability.runtime_report_clock WHERE singleton=true`))[0]).toEqual(before!);expect((await f.db.execute(sql`SELECT project FROM original_clock_facts ORDER BY project`)).map(row=>row['project'])).toEqual(['new-C','old-A','old-B']);
 });

 test('an independent project commits while an earlier writer remains open; later low-sequence commit still advances original revision',async()=>{
  const f=await fixture(),before=await originalRuntimeReportIdentity(f.db);let entered!:()=>void,release!:()=>void;const start=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);
  const a=f.db.transaction(async tx=>{await tx.execute(sql`INSERT INTO original_clock_facts VALUES('A')`);entered();await hold;});
  try{await start;await f.db.execute(sql`INSERT INTO original_clock_facts VALUES('B')`);const afterB=await originalRuntimeReportIdentity(f.db);expect(afterB.revision).toBe(String(BigInt(before.revision)+1n));expect((await f.db.execute(sql`SELECT project FROM original_clock_facts ORDER BY project`)).map(row=>row['project'])).toEqual(['B']);release();await a;const afterA=await originalRuntimeReportIdentity(f.db);expect(afterA.revision).toBe(String(BigInt(afterB.revision)+1n));expect(afterA.generation).toBe(before.generation);}finally{release();await a;}
 });
 test('an already-entered legacy writer can commit its retained anchor after upgrade while a new project uses independent receipts',async()=>{
  const previous={...observabilityMigrations,files:observabilityMigrations.files.filter(file=>file.name.localeCompare('0017_')<0)},f=await createTestDatabase([previous]);database=f;await f.db.execute(sql`CREATE TABLE original_clock_facts(project text PRIMARY KEY)`);await f.db.execute(sql`CREATE TRIGGER original_clock AFTER INSERT ON original_clock_facts FOR EACH STATEMENT EXECUTE FUNCTION observability.advance_runtime_report_clock()`);
  let entered!:()=>void,release!:()=>void;const start=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r),old=f.db.transaction(async tx=>{await tx.execute(sql`INSERT INTO original_clock_facts VALUES('old-inflight')`);entered();await hold;});
  try{await start;await runMigrations(f.db,[observabilityMigrations]);await f.db.execute(sql`INSERT INTO original_clock_facts VALUES('new-committed')`);expect((await originalRuntimeReportIdentity(f.db)).revision).toBe('1');release();await old;expect((await originalRuntimeReportIdentity(f.db)).revision).toBe('2');expect((await f.db.execute<{revision:string}>(sql`SELECT revision::text FROM observability.runtime_report_clock WHERE singleton=true`))[0]!.revision).toBe('1');expect((await f.db.execute(sql`SELECT count(*)::text AS count FROM observability.runtime_report_revisions`))[0]!['count']).toBe('1');}finally{release();await old;}
 });
 test('rollback consumes no committed revision and a fresh source snapshot sees each committed count exactly',async()=>{
  const f=await fixture(),before=await originalRuntimeReportIdentity(f.db);await expect(f.db.transaction(async tx=>{await tx.execute(sql`INSERT INTO original_clock_facts VALUES('rollback')`);throw new Error('original rollback');})).rejects.toThrow('rollback');expect(await originalRuntimeReportIdentity(f.db)).toEqual(before);
  await f.db.execute(sql`INSERT INTO original_clock_facts VALUES('committed')`);expect((await originalRuntimeReportIdentity(f.db)).revision).toBe(String(BigInt(before.revision)+1n));
 });
});
