import { expect,test } from 'bun:test';
import { DatabaseMigrationStageSchema } from '@crewstation/contracts';
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
