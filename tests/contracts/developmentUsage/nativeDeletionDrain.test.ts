// Same actual granted private Session HTTP path and original deletion fence, with real retained native v2 pages.
import {describe,expect,test} from 'bun:test';
import {testDatabaseAvailable} from '../../../packages/testkit';
import {PROJECT_DELETION_PHASES,TaskIdSchema,ProjectIdSchema} from '../../../packages/contracts';
import {observationDeletionFixture} from '../../../modules/platform/tests/observationDeletionFixture';
import {nativeNumericFixture} from './nativeNumericFixture';
import {nativeNumericPrice} from './nativeNumericPrice';
const available=await testDatabaseAvailable();
describe.skipIf(!available)('actual native v2 deletion drain after original ACK',()=>{
 test('a numeric failure after ordinary ACK retains all original pages and the stop fence; retry drains the same source and original CNY before cleanup',async()=>{
  let native:Awaited<ReturnType<typeof nativeNumericFixture>>|undefined,execution:Awaited<ReturnType<Awaited<ReturnType<typeof nativeNumericFixture>>['execution']>>|undefined;
  const f=await observationDeletionFixture({native:async(database,projectId)=>{
   native=await nativeNumericFixture(database);
   execution=await native.execution(false,{identity:{projectId:ProjectIdSchema.parse(projectId),taskId:TaskIdSchema.parse(Bun.randomUUIDv7())}});const price=await nativeNumericPrice(database,execution.registration);
   native.populate(1,0);await execution.persist('final');await execution.copySession();
   return {registration:execution.registration,price:(await price.pricing.get(execution.registration.identity))!,nativeSelection:{version:2,expectedNamespace:'acceptance-native-lineage'}};
  }});
  try {
   await f.database.handle.client`CREATE FUNCTION observability.validation_native_numeric_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF (NEW.document->'scope') ? 'native' THEN RAISE EXCEPTION 'controlled native numeric failure after original ACK'; END IF; RETURN NEW; END$$`;
   await f.database.handle.client`CREATE TRIGGER validation_native_numeric_failure BEFORE INSERT ON observability.usage_projections FOR EACH ROW EXECUTE FUNCTION observability.validation_native_numeric_failure()`;
   expect((await f.seal()).kind).toBe('done');await expect(f.owner.run(f.context('stop'))).rejects.toThrow();
   const [stream]=await f.database.handle.client`SELECT persisted_through,source_acknowledged_through FROM session.development_usage_streams WHERE task_id=${execution!.registration.runtimeTaskId}`;
   expect(stream!.source_acknowledged_through).toBe(stream!.persisted_through);expect(BigInt(stream!.persisted_through)).toBeGreaterThan(0n);
   const [pass]=await f.database.handle.client`SELECT pass_key,work_state FROM observability.development_native_passes WHERE project_id=${f.projectId}`;expect(pass!.work_state).toBe('pending');
   expect((await f.database.handle.client`SELECT phase_index FROM observability.deletion_fences`)[0]!.phase_index).toBe(0);
   expect(await f.database.handle.client`SELECT document FROM observability.usage_projections`).toHaveLength(114);
   await f.database.handle.client`DROP TRIGGER validation_native_numeric_failure ON observability.usage_projections`;
   expect((await f.owner.run(f.context('stop'))).kind).toBe('done');
   expect(await f.database.handle.client`SELECT document FROM observability.usage_projections`).toHaveLength(115);expect(await f.database.handle.client`SELECT document FROM observability.execution_valuations`).toHaveLength(115);
   const [value]=await f.database.handle.client`SELECT document FROM observability.execution_valuations WHERE document->'identity'->>'executionId'=${execution!.registration.runtimeTaskId}`;
   expect(value!.document).toMatchObject({currency:'CNY',amountDecimal:'0.0000425',availability:'priced',completeness:'complete'});
   expect((await f.database.handle.client`SELECT work_state FROM observability.development_native_passes WHERE pass_key=${pass!.pass_key}`)[0]!.work_state).toBe('processed');
   for(const phase of PROJECT_DELETION_PHASES.slice(2))expect((await f.owner.run(f.context(phase))).kind).toBe('done');
   expect(await f.database.handle.client`SELECT pass_key FROM observability.development_native_passes WHERE project_id=${f.projectId}`).toHaveLength(0);
   expect(await f.database.handle.client`SELECT meter_key FROM observability.usage_projections`).toHaveLength(0);
  }finally{f.restore();await native?.close();await f.close();}
 },60_000);
});
