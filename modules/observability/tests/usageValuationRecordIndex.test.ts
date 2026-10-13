// RFC-034: original valuation trigger matching is exact and uncapped, even
// where two physical meter keys carry the same original external identity.
import {afterEach,expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {jsonHash} from '@crewstation/kernel';
import {UsageValuationSchema} from '@crewstation/contracts';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {observabilityMigrations} from '../wiring';
import {completeCohortFixture} from './completeCohortFixture';
import {executionValuations} from '../adapters/persistence/tables';
const available=await testDatabaseAvailable();let db:TestDatabase|undefined;afterEach(async()=>{await db?.drop();db=undefined;});
interface Plan {'Index Name'?:string;Plans?:Plan[]}
function indexes(plan:Plan):string[]{return [...(plan['Index Name']?[plan['Index Name']]:[]),...(plan.Plans??[]).flatMap(indexes)];}
test.skipIf(!available)('10001 physical records use the exact identity index and a valuation dirties every matching original meter',async()=>{
 db=await createTestDatabase([observabilityMigrations]);const f=completeCohortFixture(),original=f.records[0]!,taskKey=jsonHash({projectId:f.projectId,taskId:f.tasks[0]!.id});
 await db.db.execute(sql`INSERT INTO observability.usage_projections(meter_key,task_key,document) SELECT 'physical-'||n,${taskKey},${JSON.stringify(original)}::jsonb||jsonb_build_object('recordId',CASE WHEN n IN(0,10000) THEN 'original-duplicate' ELSE 'record-'||n END) FROM generate_series(0,10000)n`);
 await db.db.execute(sql`ANALYZE observability.usage_projections`);
 const plan=(await db.db.execute<{'QUERY PLAN':{Plan:Plan}[]}>(sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT meter_key FROM observability.usage_projections WHERE task_key=${taskKey} AND document->'identity'=${JSON.stringify(original.identity)}::jsonb AND document->>'sourceId'=${original.sourceId} AND document->>'recordId'='original-duplicate'`))[0]!['QUERY PLAN'][0]!.Plan;
 expect(indexes(plan)).toContain('usage_projection_valuation_match');expect((await db.db.execute(sql`SELECT count(*)::text AS count FROM observability.usage_projections`))[0]?.['count']).toBe('10001');
 // Clear only the derived queue to observe this one original valuation commit.
 await db.db.execute(sql`DELETE FROM observability.runtime_task_record_work`);
 const value=UsageValuationSchema.parse({kind:'valuation',identity:original.identity,sourceId:original.sourceId,recordId:'original-duplicate',revision:1,occurredAt:original.occurredAt,observedAt:original.observedAt,valuationId:'exact-index-proof',valuationRevision:1,usageRevision:original.projection.projectionRevision,currency:'CNY',completeness:'complete',availability:'priced',priceVersionRef:'ACCEPTANCE-ONLY-CNY-NOT-SUPPLIER-BILL',amountDecimal:'0.07'});
 await db.db.insert(executionValuations).values({meterKey:'value-exact',taskKey,basisFingerprint:jsonHash(value),document:value});
 const pending=await db.db.execute<{key:string}>(sql`SELECT meter_key AS key FROM observability.runtime_task_record_work WHERE task_id=${original.identity.taskId} ORDER BY meter_key`);expect(pending.map(row=>row.key)).toEqual(['physical-0','physical-10000']);
 expect((await db.db.execute(sql`SELECT count(*)::text AS count FROM observability.usage_projections`))[0]?.['count']).toBe('10001');
},30000);
