import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Actor,ProjectId} from '@crewstation/contracts';
import {newResourceId} from '@crewstation/kernel';
import {connectDatabase} from '@crewstation/persistence';
import {createTestDatabase} from '@crewstation/testkit';
import {observabilityMigrations} from '../../wiring';
import {completeRuntimeReportCache} from '../../adapters/persistence/reports/reportStore';
import {completeRuntimeFileSpool} from '../../adapters/persistence/reports/fileSpool';
import {completeRuntimeReportUseCases} from '../../application/complete-statistics/reportService';
import type {CompleteReportRequest,CompleteReportSourceCollection} from '../../ports/completeRuntimeReportCache';
export async function collectionReportFixture(){
 const tdb=await createTestDatabase([observabilityMigrations]),handle=connectDatabase(tdb.url,{max:1}),store=completeRuntimeReportCache(handle.db),root=mkdtempSync(join(tmpdir(),'cs-native-collection-cache-')),spool=completeRuntimeFileSpool(root),actor={userId:newResourceId(),isAdmin:true} as Actor;
 const requests:CompleteReportRequest[]=[],workers:ReturnType<typeof completeRuntimeReportUseCases>['worker'][]=[];
 const api=(sourceCollection?: (projectId:ProjectId|null)=>CompleteReportSourceCollection|undefined)=>{
  const useCases=completeRuntimeReportUseCases({store,spool,owner:newResourceId(),authorizer:{authorize:async()=>{}},costVisible:async()=>true,sourceCollection,build:async report=>{requests.push(structuredClone(report.request));return {state:'not-ready',gaps:[{source:'explicit-unavailable-fixture',reason:'no numeric report is fabricated'}]};}});workers.push(useCases.worker);return useCases;
 };
 return {tdb,handle,store,spool,actor,requests,api,close:async()=>{for(const worker of workers)await worker.stop();await handle.close();await tdb.drop();rmSync(root,{recursive:true,force:true});}};
}
