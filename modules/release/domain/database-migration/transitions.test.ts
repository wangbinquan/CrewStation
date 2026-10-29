import { expect,test } from 'bun:test';
import { DatabaseMigrationJobPurposeSchema, DatabaseMigrationStageSchema } from '@crewstation/contracts';
import { assertMigrationTransition } from './transitions';
import { migrationActions,migrationConfirmation } from './operation';
import type { DatabaseMigrationOperation } from './operation';
const edges=['requested:provisioning','provisioning:building','building:planning','planning:awaiting-approval','awaiting-approval:approved','awaiting-approval:planning','approved:freezing','approved:planning','freezing:migrating','migrating:awaiting-reapproval','migrating:activating','awaiting-reapproval:migrating','activating:verifying','verifying:ready-to-open','ready-to-open:opening','opening:completing','completing:completed','rolling-back:rolled-back'];
test('all stage pairs admit only the designed forward, rollback and abandon paths',()=>{
 const before=['requested','provisioning','building','planning','awaiting-approval','approved'],rollback=['freezing','migrating','awaiting-reapproval','activating','verifying','ready-to-open'];
 for(const from of DatabaseMigrationStageSchema.options)for(const to of DatabaseMigrationStageSchema.options){const allowed=from===to||edges.includes(`${from}:${to}`)||to==='abandoned'&&before.includes(from)||to==='rolling-back'&&rollback.includes(from);if(allowed)expect(()=>assertMigrationTransition(from,to)).not.toThrow();else expect(()=>assertMigrationTransition(from,to)).toThrow();}
});
test('confirmation binds revision, approval, image and generations; blocked plans cannot approve and opening cannot roll back',()=>{
 const op={id:'op',revision:3,stage:'approved',image:'image',sourceGenerationId:'source',targetGenerationId:'target',plan:{plan:{digest:'plan',approvalDigest:'approved',payload:{blocks:[]}}},approval:{digest:'approved'},receipts:{},error:null} as unknown as DatabaseMigrationOperation;
 const digest=migrationConfirmation(op);expect(digest).toMatch(/^[a-f0-9]{64}$/);
 for(const delta of [{revision:4},{image:'other'},{sourceGenerationId:'other'},{targetGenerationId:'other'},{approval:{digest:'changed'}}])expect(migrationConfirmation({...op,...delta} as DatabaseMigrationOperation)).not.toBe(digest);
 expect(migrationActions({...op,stage:'opening'})).not.toContain('rollback');expect(migrationActions({...op,stage:'awaiting-approval',plan:{plan:{payload:{blocks:[{}]}}}} as DatabaseMigrationOperation)).not.toContain('approve');
 expect(migrationActions({...op,stage:'awaiting-reapproval'})).toContain('approve');expect(migrationActions({...op,stage:'verifying',error:'failed'})).toEqual(['retry','rollback']);
});
const failedRollback=()=>({
 stage:'rolling-back',abandonRequested:false,error:'迁移 Job 失败（exit）',rollbackRequest:null,
 receipts:{verify:{payload:{operationId:'dbm_e2_fixture1'},digest:'sha256:'+'a'.repeat(64)}},
 currentAttempt:{jobId:'job',purpose:'database-migration-rollback',receiptDigest:null,proof:{receipt:{state:'failed'}}},
} as DatabaseMigrationOperation);
test('a failed rollback after verification offers cancel-rollback alongside retry and permits returning to ready-to-open',()=>{
 // RFC-044 T9：应用拒绝撤回后，管理员曾只能反复重试同一失败，无法开放已验证的候选。
 const op=failedRollback();expect(migrationActions(op)).toEqual(['retry','cancel-rollback']);
 expect(()=>assertMigrationTransition(op.stage,'ready-to-open',op)).not.toThrow();
 expect(()=>assertMigrationTransition(op.stage,'ready-to-open')).toThrow();
});
const rollbackBlockers:Array<[string,(op:DatabaseMigrationOperation)=>void]>=[
 ['abandon requested',op=>{op.abandonRequested=true;}],
 ['no operation error',op=>{op.error=null;}],
 ['no current attempt',op=>{op.currentAttempt=null;}],
 ['no proof',op=>{op.currentAttempt!.proof=null;}],
 ...(['pending','running','succeeded'] as const).map(state=>[`${state} receipt`,(op:DatabaseMigrationOperation)=>{op.currentAttempt!.proof!.receipt.state=state;}] as [string,(op:DatabaseMigrationOperation)=>void]),
 ['successful rollback receipt',op=>{op.receipts.rollback=op.receipts.verify;}],
 ['binding rollback requested',op=>{op.rollbackRequest='rollback-request';}],
 ['no verification receipt',op=>{delete op.receipts.verify;}],
 ...DatabaseMigrationJobPurposeSchema.options.filter(purpose=>purpose!=='database-migration-rollback').map(purpose=>[purpose,(op:DatabaseMigrationOperation)=>{op.currentAttempt!.purpose=purpose;}] as [string,(op:DatabaseMigrationOperation)=>void]),
 ...DatabaseMigrationStageSchema.options.filter(stage=>stage!=='rolling-back').map(stage=>[stage,(op:DatabaseMigrationOperation)=>{op.stage=stage;}] as [string,(op:DatabaseMigrationOperation)=>void]),
];
for(const [reason,change] of rollbackBlockers)test(`cancel-rollback is unavailable with ${reason}`,()=>{
 const op=failedRollback();change(op);expect(migrationActions(op)).not.toContain('cancel-rollback');
 expect(()=>assertMigrationTransition('rolling-back','ready-to-open',op)).toThrow();
});
