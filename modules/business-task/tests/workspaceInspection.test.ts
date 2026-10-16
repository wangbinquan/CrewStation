import {afterEach,expect,test} from 'bun:test';
import {createTestDatabase,testDatabaseAvailable,type TestDatabase} from '@crewstation/testkit';
import {businessTaskMigrations} from '../wiring';
import {executionCommandFixture} from './executionCommandFixture';
const available=await testDatabaseAvailable();let db:TestDatabase|undefined;
afterEach(async()=>{await db?.drop();db=undefined;});
test.skipIf(!available)('physical workspace inspection is read only and distinguishes missing, changed, paused and unknown resources',async()=>{
 db=await createTestDatabase([businessTaskMigrations]);const f=await executionCommandFixture(db.db),path=`/v3/business-tasks/${f.task.id}/workspace-inspection`;
 const proof={state:'paused',persistent:true,stopped:true,activeChildren:false,volumeUid:'original-pvc',volumeVerified:true,volumePresent:true};
 f.environmentPort.inspectBusinessRecovery=async()=>proof;
 expect(await(await f.request(path)).json()).toMatchObject({taskId:f.task.id,generation:f.task.generation,volumeUid:'original-pvc',state:'present'});
 proof.volumeVerified=false;expect(await(await f.request(path)).json()).toMatchObject({state:'unknown'});
 proof.volumePresent=false;expect(await(await f.request(path)).json()).toMatchObject({state:'absent'});
 proof.activeChildren=true;expect(await(await f.request(path)).json()).toMatchObject({state:'unknown'});
 f.environmentPort.inspectBusinessRecovery=async()=>undefined;expect(await(await f.request(path)).json()).toMatchObject({state:'unknown'});
 f.environmentPort.inspectBusinessRecovery=async()=>{throw new Error('offline');};expect((await f.request(path)).status).toBe(500);
 expect((await f.request(path,undefined,'forged')).status).toBe(403);expect(f.commands).toHaveLength(0);
});
