import {sql,type SQL} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import {jsonHash,conflict} from '@crewstation/kernel';
import {RuntimeNativePagedCaptureSchema,type RuntimeNativePagedCapture} from '@crewstation/contracts';
import {developmentCaptureSourceId} from '../../../domain/developmentNative';
import {originalNativePassFinished} from '../../../domain/developmentUsage/nativeBaselineQualification';
import type {DevelopmentNativePassMetadata,DevelopmentNativePageMetadata} from '../../../domain/developmentUsage/metadata';
import type {DevelopmentNativePassProgress} from '../../../domain/developmentUsage/progress';
import type {NativeDevelopmentWork} from '../../../ports/nativeDevelopmentLedger';
import {readNativePathQualification} from './nativePathQualification';
import {pendingNativeDevelopmentValues} from './nativeWork';
interface PassRow extends Record<string,unknown> {pass_key:string;source_id:string;document:DevelopmentNativePassMetadata;fingerprint:string;
 progress:DevelopmentNativePassProgress;state:'receiving'|'source-eof';work_state:'pending'|'processed';work_cursor:string|null;work:NativeDevelopmentWork|null}
async function originalPages(db:Executor,pass:PassRow) {
 const issues=new Set<string>();let after:string|null=null,ordinal=0n,eof:DevelopmentNativePageMetadata|null=null;
 for(;;) {
  const rows:readonly {ordinal:string;document:DevelopmentNativePageMetadata;fingerprint:string;complete:boolean}[]=await db.execute<{ordinal:string;document:DevelopmentNativePageMetadata;fingerprint:string;complete:boolean}>(sql`
   SELECT ordinal::text,document,fingerprint,complete FROM observability.development_native_pages WHERE pass_key=${pass.pass_key}
    ${after===null?sql``:sql`AND ordinal::numeric>${after}::numeric`} ORDER BY ordinal::numeric LIMIT 100`);
  for(const row of rows) {
   if(row.ordinal!==String(ordinal++)||row.document.ordinal!==row.ordinal||jsonHash(row.document)!==row.fingerprint||jsonHash(row.document.ack.identity)!==jsonHash(pass.progress.identity))throw conflict('原生报告原页摘要、连续位置或身份不符');
   for(const issue of row.document.issues)issues.add(issue);
   if(!row.complete)issues.add('native-page-incomplete');
   if(row.document.eof) {if(eof)throw conflict('原生报告不能有多个原 EOF');eof=row.document;}
  }
  if(rows.length<100)break;after=rows.at(-1)!.ordinal;
 }
 if(pass.state==='source-eof'&&String(ordinal)!==pass.progress.ordinal)throw conflict('原生报告原页人口未匹配原 EOF');
 return {issues:[...issues],eof};
}
async function capture(db:Executor,row:PassRow):Promise<RuntimeNativePagedCapture> {
 const document=row.document,progress=row.progress,work=row.work;
 if(jsonHash(document)!==row.fingerprint||row.source_id!==document.streamSourceId||row.pass_key!==jsonHash({streamSourceId:row.source_id,passId:progress.identity.passId})||jsonHash(document.admission.identity)!==jsonHash(progress.identity))throw conflict('原生报告 pass 原登记或来源不符');
 const pages=await originalPages(db,row),pathsComplete=await readNativePathQualification(db,row.pass_key,document,progress);
 if(row.state==='source-eof'&&!originalNativePassFinished({key:row.pass_key,document,progress,state:row.state,pathsComplete,sourceHasIssues:pages.issues.length>0,eofPage:pages.eof})) {
  // A missing parent path remains an explicit gap. All other source EOF bindings must match independently.
  if(!originalNativePassFinished({key:row.pass_key,document,progress,state:row.state,pathsComplete:true,sourceHasIssues:pages.issues.length>0,eofPage:pages.eof}))throw conflict('原生报告的原 EOF 摘要或扫描水位不符');
 }
 if(work&&(work.passKey!==row.pass_key||(!row.work_cursor||jsonHash(JSON.parse(row.work_cursor))!==jsonHash({ordinal:work.ordinal,index:work.index}))))throw conflict('原生报告工作游标不属于同一 pass');
 const identity=document.registration.identity,pending=(await pendingNativeDevelopmentValues(db)({projectId:identity.projectId,taskId:identity.taskId},row.pass_key,1)).length>0;
 const valuationEof=work?.valuationEof===true&&!pending,issues=new Set([...pages.issues,...(work?.issues??[])]);
 if(work?.previousPopulation&&!work.numericEof)for(const issue of work.previousPopulation.issues)issues.add(issue);
 return RuntimeNativePagedCaptureSchema.parse({id:row.pass_key,sourceVersion:2,identity,sourceId:developmentCaptureSourceId(row.source_id,progress.identity.turn,document.preparation.turnIndex),
  pass:progress.identity,turnIndex:document.preparation.turnIndex,preparedAt:document.preparation.observedAt,sourceState:row.state,
  pages:progress.ordinal,counts:progress.counts,scanPosition:progress.scanPosition,sourceWatermark:progress.sourceWatermark,pathsComplete,
  workState:row.work_state==='processed'&&valuationEof?'processed':'pending',visitedSteps:work?.visited??'0',heldSteps:work?.held??'0',
  cursor:{ordinal:work?.ordinal??'0',index:work?.index??0},numericEof:work?.numericEof??false,valuationEof,baselineState:work?.baselineState??'unknown',
  issues:[...issues],sourceDigest:jsonHash({fingerprint:row.fingerprint,progress,source:pages.eof?.cumulativeDigest??null,work,pathsComplete}),
  ...(work?.previousPopulation?{previousPopulation:work.previousPopulation}:{})});
}
/** True EOF over original pass keys in the same reserved report snapshot. No numeric copies. */
export function nativeReportCaptures(db:Executor,selected:SQL,pageSize:number) {
 return async(after:string|undefined)=>{
  const rows=await db.execute<PassRow>(sql`SELECT p.pass_key,p.source_id,p.document,p.fingerprint,p.progress,p.state,p.work_state,p.work_cursor,w.document AS work
   FROM observability.development_native_passes p LEFT JOIN observability.development_native_work w USING(pass_key)
   WHERE ${selected} ${after===undefined?sql``:sql`AND p.pass_key>${after}`} ORDER BY p.pass_key LIMIT ${pageSize+1}`);
  const selectedRows=rows.slice(0,pageSize),items:RuntimeNativePagedCapture[]=[];
  for(const row of selectedRows)items.push(await capture(db,row));
  return {items,nextCursor:rows.length>pageSize?selectedRows.at(-1)!.pass_key:null};
 };
}
