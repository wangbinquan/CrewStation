import { describe, expect, test } from 'bun:test';
import type { z } from 'zod';
import * as C from './databaseMigration';
import * as B from './databaseMigrationCallbacks';
import { ServiceSpecSchema } from '../../manifest/serviceSpec';
const id='01a1428f-eabe-7000-af4c-887037988564',op='dbm_e2_'+id.replaceAll('-',''),digest='sha256:'+'a'.repeat(64);
const plan={payload:{operationId:op,source:{provider:'postgresql'},target:{generationId:'dbg_'+'b'.repeat(32),location:{kind:'postgresql-target',profileRef:'crewstation:target'}},blocks:[]},digest,approvalDigest:digest};
const view={operationId:op,plan,jsonPath:null,markdownPath:null,acknowledgeable:[],requiresApproval:true,guidance:[]};
const create={requestId:id,expectedActiveGenerationId:id,expectedActiveReleaseId:id,branch:'main',expectedCommitSha:'a'.repeat(40)};
const dto={id,projectId:id,serviceId:id,revision:1,stage:'planning',sourceGenerationId:id,targetGenerationId:id,scratchGenerationId:id,sourceReleaseId:id,candidateReleaseId:id,branch:'main',commitSha:'a'.repeat(40),candidateTag:'v1.0.1+migrate.x',image:null,plan:view,approval:null,confirmationDigest:null,actions:['abandon'],blockedReason:null,error:null,observation:null,attempts:[],createdBy:id,createdAt:'2026-10-28T00:00:00Z',updatedAt:'2026-10-28T00:00:00Z'};
const shapes:Array<[z.ZodType,unknown]>=[
 [C.ServiceDatabaseMigrationSchema,{command:['app','migrate'],verifyCommand:['app','verify'],sourceKeyConfig:'AW_SECRET_KEY'}],
 [C.CreateDatabaseMigrationSchema,create],...[C.RetryDatabaseMigrationSchema,C.ReplanDatabaseMigrationSchema,C.AbandonDatabaseMigrationSchema,C.RollbackDatabaseMigrationSchema,C.CancelRollbackDatabaseMigrationSchema].map(s=>[s,{expectedRevision:1}] as [z.ZodType,unknown]),
 [C.ApproveDatabaseMigrationSchema,{expectedRevision:1,approvalDigest:digest}],[C.SwitchDatabaseMigrationSchema,{expectedRevision:1,confirmationDigest:'a'.repeat(64)}],[C.OpenDatabaseMigrationSchema,{expectedRevision:1,confirmationDigest:'a'.repeat(64)}],
 [C.DatabaseMigrationPlanSchema,plan],[C.DatabaseMigrationPlanViewSchema,view],[C.DatabaseMigrationApprovalRequestSchema,{operationId:op,runId:'run',planDigest:digest,approvalDigest:digest,planPath:null}],
 [C.DatabaseMigrationReceiptSchema,{payload:{operationId:op},digest}],[C.DatabaseMigrationAttemptSchema,{jobId:id,purpose:'database-migration-plan',receipt:null,logTail:'',receiptDigest:null}],[C.DatabaseMigrationDtoSchema,dto],[C.DatabaseMigrationListSchema,{items:[dto]}],
 [B.MigrationArtifactWriteSchema,{operationId:op,name:'test.json',digest,bytes:'e30=',requestKey:'key'}],[B.MigrationArtifactQuerySchema,{operationId:op,name:'test.json'}],[B.MigrationArtifactSchema,{bytes:'e30=',digest}],[B.MigrationArtifactWrittenSchema,{digest,bytes:2}],
 [B.MigrationFreezeVerifySchema,{operationId:op,reference:'freeze',sourceGenerationId:id,writersStopped:true}],[B.MigrationFreezeVerifiedSchema,{verified:true}],
 [B.MigrationPreparedSchema,{operationId:op,generationId:'dbg_'+'b'.repeat(32),receiptDigest:digest,location:{kind:'postgresql-target',profileRef:'crewstation:target'},requestKey:'key'}],
 [B.MigrationActivationQuerySchema,{operationId:op}],[B.MigrationActivationSchema,{pointsAt:'source',pointerDigest:null}],[B.MigrationRollbackSchema,{requestKey:'key'}],[B.MigrationBackupQuerySchema,{reference:'backup'}],[B.MigrationCallbackAckSchema,{}],[B.MigrationCallbackErrorSchema,{error:'unavailable',message:'retry',details:{}}],
];
describe('RFC-044 strict requests and DTOs',()=>{
 test('cancel-rollback is an additive action and requires a positive integer revision',()=>{
  expect(C.DatabaseMigrationActionSchema.parse('cancel-rollback')).toBe('cancel-rollback');
  expect(C.DatabaseMigrationDtoSchema.parse({...dto,stage:'rolling-back',actions:['retry','cancel-rollback']}).actions).toEqual(['retry','cancel-rollback']);
  for(const input of [{},{expectedRevision:0},{expectedRevision:-1},{expectedRevision:1.5},{expectedRevision:'1'}])expect(C.CancelRollbackDatabaseMigrationSchema.safeParse(input).success).toBe(false);
 });
 test('every new object contract accepts its wire shape and rejects unknown outer keys',()=>{for(const [schema,value] of shapes){expect(schema.safeParse(value).success).toBe(true);expect(schema.safeParse({...value as object,unexpected:true}).success).toBe(false);}});
 test('manifest optional migration keeps service defaults and refuses operator command overrides',()=>{
  const service=ServiceSpecSchema.parse({command:['app'],port:3000,servicePlanId:id,databaseMigration:{command:['app','migrate'],verifyCommand:['app','verify']}});expect(service.replicas).toBe(1);expect(service.databaseMigration?.sourceKeyConfig).toBeUndefined();
  expect(C.ServiceDatabaseMigrationSchema.safeParse({command:[],verifyCommand:['x']}).success).toBe(false);expect(C.ServiceDatabaseMigrationSchema.safeParse({command:['x\0'],verifyCommand:['x']}).success).toBe(false);
  expect(C.CreateDatabaseMigrationSchema.safeParse({...create,command:['shell']}).success).toBe(false);expect(C.CreateDatabaseMigrationSchema.safeParse({...create,expectedCommitSha:'HEAD'}).success).toBe(false);
 });
 test('a migration may declare its own service plan; it must be a resource id',()=>{
  const plan='01a1428f-eabe-7000-af4c-887037988599';
  expect(C.ServiceDatabaseMigrationSchema.parse({command:['app','migrate'],verifyCommand:['app','verify'],servicePlanId:plan}).servicePlanId).toBe(plan);
  expect(C.ServiceDatabaseMigrationSchema.parse({command:['app','migrate'],verifyCommand:['app','verify']}).servicePlanId).toBeUndefined();
  expect(C.ServiceDatabaseMigrationSchema.safeParse({command:['app','migrate'],verifyCommand:['app','verify'],servicePlanId:'large'}).success).toBe(false);
 });
 test('callback nullable missing artifacts and canonical digests are explicit',()=>{expect(B.MigrationArtifactSchema.parse(null)).toBeNull();expect(C.DatabaseMigrationDigestSchema.safeParse('a'.repeat(64)).success).toBe(false);expect(C.DatabaseMigrationOperationIdSchema.safeParse(id).success).toBe(false);expect(B.MigrationPreparedSchema.safeParse({operationId:op,generationId:id,receiptDigest:digest,location:{kind:'postgresql-target',profileRef:'env:TARGET'},requestKey:'x'}).success).toBe(false);});
 // RFC-044 T9 本机验收：AW 把大产物按 4 MiB 分块写入，base64 约 559 万字符。原先的分组正则在 Bun 1.3.13（平台与 CI 所用版本）上
 // 对这样长的合法串返回 false，每个分块都被判为「回调请求格式不合法」，plan Job 以 exit 失败。
 test('artifact bytes accept a full 4 MiB chunk and still refuse non-canonical base64',()=>{
  const chunk=new Uint8Array(4*1024*1024);for(let i=0;i<chunk.length;i++)chunk[i]=(i*31+7)&255;
  const write={operationId:op,name:'.artifacts/source-catalogs/x.json.content/'+'c'.repeat(64)+'/0',digest,bytes:Buffer.from(chunk).toString('base64'),requestKey:'key'};
  expect(B.MigrationArtifactWriteSchema.safeParse(write).success).toBe(true);expect(B.MigrationArtifactSchema.safeParse({bytes:write.bytes,digest}).success).toBe(true);
  for(const bytes of ['abc','ab=c','a===','YQ','YQ=','YR==','Y Q==','====','e30=\n'])expect(B.MigrationArtifactWriteSchema.safeParse({...write,bytes}).success).toBe(false);
  expect(B.MigrationArtifactWriteSchema.safeParse({...write,bytes:''}).success).toBe(true);
 });
});
