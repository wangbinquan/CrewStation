import type { DatabaseMigrationStage } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import { migrationActions, migrationBeforeFreeze, migrationRollbackAllowed } from './operation';
import type { DatabaseMigrationOperation } from './operation';
const forwards:Partial<Record<DatabaseMigrationStage,DatabaseMigrationStage[]>>={
 requested:['provisioning'],provisioning:['building'],building:['planning'],planning:['awaiting-approval'],
 'awaiting-approval':['approved','planning'],approved:['freezing','planning'],freezing:['migrating'],
 migrating:['awaiting-reapproval','activating'],'awaiting-reapproval':['migrating'],activating:['verifying'],
 verifying:['ready-to-open'],'ready-to-open':['opening'],opening:['completing'],completing:['completed'],'rolling-back':['rolled-back'],
};
export function assertMigrationTransition(from:DatabaseMigrationStage,to:DatabaseMigrationStage,operation?:DatabaseMigrationOperation){
 if(from==='rolling-back'&&to==='ready-to-open'&&operation?.stage===from&&migrationActions(operation).includes('cancel-rollback'))return;
 if(from===to||forwards[from]?.includes(to)||to==='abandoned'&&migrationBeforeFreeze({stage:from})||to==='rolling-back'&&migrationRollbackAllowed({stage:from}))return;
 throw conflict(`数据库迁移不能从 ${from} 进入 ${to}`,{code:'database_migration_invalid_stage'});
}
