import {sql} from 'drizzle-orm';
import type {Database,Executor} from '@crewstation/persistence';
import {RuntimeCompleteReportSchema} from '@crewstation/contracts';
import type {CompleteRuntimeReportCache,CompleteReportStored,CompleteReportRequest,CompleteReportTransferPage,CompleteReportManifest} from '../../../ports/completeRuntimeReportCache';
import {completeReportInitialDigest,assertCompleteReportTransferPage} from '../../../domain/completeReportEnvelope';
import {assertPublishedRuntimeReport} from './reportIntegrity';
import {completeRuntimeReportPage} from './reportStorePage';
import {admitRuntimeReport,assertRuntimeReportProjects,assertRuntimeReportPageProjects} from './reportAdmission';
const json=(value:unknown)=>JSON.stringify(value);
function stored(row:Record<string,unknown>):CompleteReportStored {
 return {id:String(row['id']),requestKey:String(row['request_key']),owner:String(row['owner']),request:row['request'] as CompleteReportRequest,state:row['state'] as CompleteReportStored['state'],report:RuntimeCompleteReportSchema.parse(row['report'])};
}
async function owned(db:Executor,id:string,owner:string) {
 const [row]=await db.execute(sql`SELECT * FROM observability.runtime_reports WHERE id=${id} FOR UPDATE`);
 if(!row||row['owner']!==owner||row['state']!=='building')throw new Error('Original runtime report publication ownership changed');
 return row;
}
export async function originalRuntimeReportIdentity(db:Executor) {
 const [row]=await db.execute(sql`SELECT (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS generation,(revision+(SELECT count(*) FROM observability.runtime_report_revisions))::text AS revision FROM observability.runtime_report_clock WHERE singleton=true`);
 if(!row||!/^(0|[1-9]\d*)$/.test(String(row['revision']))||!/^[1-9]\d*$/.test(String(row['generation'])))throw new Error('Original runtime report authority identity missing');
 return {generation:String(row['generation']),revision:String(row['revision'])};
}
async function stageReportPage(db:Database,id:string,owner:string,page:CompleteReportTransferPage) {
 await db.transaction(async tx=>{
  await admitRuntimeReport(tx);await owned(tx,id,owner);await assertRuntimeReportProjects(tx,id);
  const projects=page.items.flatMap(item=>item.kind==='row'&&item.row.section==='tasks'&&item.row.document&&typeof item.row.document==='object'&&'projectId' in item.row.document?[String(item.row.document.projectId)]:[]);
  await assertRuntimeReportPageProjects(tx,projects);
  const [previous]=await tx.execute(sql`SELECT digest,items_count FROM observability.runtime_report_pages WHERE report_id=${id} AND ordinal=${page.ordinal}::numeric`);
  if(previous){if(previous['digest']!==page.digest||Number(previous['items_count'])!==page.items.length)throw new Error('Original staging report replay changed');return;}
  const [tail]=await tx.execute(sql`SELECT ordinal::text,digest FROM observability.runtime_report_pages WHERE report_id=${id} ORDER BY observability.runtime_report_pages.ordinal DESC LIMIT 1`);
  assertCompleteReportTransferPage(page,id,tail?String(BigInt(String(tail['ordinal']))+1n):'0',tail?String(tail['digest']):completeReportInitialDigest);
  const indexed=page.items.map((item,index)=>({item,ordinal:String(BigInt(page.ordinal)*500n+BigInt(index))}));
  const rows=indexed.flatMap(({item,ordinal})=>item.kind==='row'?[sql`(${id},${ordinal}::numeric,${item.row.section},${item.row.parent??''},${item.row.key},${json(item.row.document)}::jsonb)`]:[]);
  const counts=page.items.flatMap(item=>item.kind==='count'?[sql`(${id},${item.section},${item.parent??''},${item.total}::numeric)`]:[]);
  const receipts=page.items.flatMap(item=>item.kind==='receipt'?[sql`(${id},${item.key},${json(item.document)}::jsonb)`]:[]);
  if(rows.length)await tx.execute(sql`INSERT INTO observability.runtime_report_rows(report_id,ordinal,section,parent,key,document) VALUES ${sql.join(rows,sql`,`)}`);
  if(counts.length)await tx.execute(sql`INSERT INTO observability.runtime_report_counts(report_id,section,parent,total) VALUES ${sql.join(counts,sql`,`)}`);
  if(receipts.length)await tx.execute(sql`INSERT INTO observability.runtime_report_receipts(report_id,key,document) VALUES ${sql.join(receipts,sql`,`)}`);
  await tx.execute(sql`INSERT INTO observability.runtime_report_pages(report_id,ordinal,previous_digest,digest,items_count) VALUES(${id},${page.ordinal}::numeric,${page.previousDigest},${page.digest},${page.items.length})`);
 });
}
async function publishReport(db:Database,id:string,owner:string,manifest:CompleteReportManifest) {
 const facts=manifest.header.coverage==='complete-facts',report=RuntimeCompleteReportSchema.parse(facts?{reportId:id,state:'not-ready',gaps:manifest.summary.metrics.state==='not-ready'?manifest.summary.metrics.gaps.map(reason=>({source:'original-cohort',reason})):[],facts:{header:manifest.header,summary:manifest.summary}}:{reportId:id,state:'ready',header:manifest.header,summary:manifest.summary});
 await db.transaction(async tx=>{
  await admitRuntimeReport(tx);const row=await owned(tx,id,owner),identity=await originalRuntimeReportIdentity(tx);
  await assertRuntimeReportProjects(tx,id,(row['request'] as CompleteReportRequest).projectId);
  if(manifest.reportId!==id||manifest.requestKey!==row['request_key']||manifest.buildOwner!==owner||identity.generation!==manifest.generation)throw new Error('Original complete report manifest or generation changed');
  await assertPublishedRuntimeReport(tx,id,report,manifest);
  await tx.execute(sql`UPDATE observability.runtime_reports SET state=${report.state},report=${json(report)}::jsonb,manifest=${json(manifest)}::jsonb WHERE id=${id} AND owner=${owner} AND state='building'`);
 });
}
export function completeRuntimeReportCache(db:Database):CompleteRuntimeReportCache {
 const get=async(id:string)=>db.transaction(async tx=>{await admitRuntimeReport(tx);const [row]=await tx.execute(sql`SELECT * FROM observability.runtime_reports WHERE id=${id}`);if(!row)return undefined;await assertRuntimeReportProjects(tx,id,(row['request'] as CompleteReportRequest).projectId);const report=stored(row);await assertPublishedRuntimeReport(tx,id,report.report,row['manifest'] as CompleteReportManifest|null);return report;});
 const terminal=async(id:string,owner:string,state:'not-ready'|'failed',report:unknown)=>{const value=RuntimeCompleteReportSchema.parse(report);await db.transaction(async tx=>{await owned(tx,id,owner);await tx.execute(sql`DELETE FROM observability.runtime_report_pages WHERE report_id=${id}`);await tx.execute(sql`DELETE FROM observability.runtime_report_rows WHERE report_id=${id}`);await tx.execute(sql`DELETE FROM observability.runtime_report_counts WHERE report_id=${id}`);await tx.execute(sql`DELETE FROM observability.runtime_report_receipts WHERE report_id=${id}`);await tx.execute(sql`UPDATE observability.runtime_reports SET state=${state},report=${json(value)}::jsonb WHERE id=${id}`);});};
 return {identity:()=>originalRuntimeReportIdentity(db),get,
  async claim(id,owner){return db.transaction(async tx=>{
   await admitRuntimeReport(tx);await assertRuntimeReportProjects(tx,id);const [row]=await tx.execute(sql`SELECT *,lease_until<=clock_timestamp() AS expired FROM observability.runtime_reports WHERE id=${id} FOR UPDATE`);if(!row)throw new Error('Original report recovery request missing');
   const canRecover=row['state']==='failed'||row['state']==='building'&&row['expired']===true;
   if(canRecover){
    for(const table of ['runtime_report_pages','runtime_report_rows','runtime_report_counts','runtime_report_receipts'])await tx.execute(sql`DELETE FROM ${sql.identifier('observability')}.${sql.identifier(table)} WHERE report_id=${id}`);
    await tx.execute(sql`UPDATE observability.runtime_reports SET owner=${owner},state='building',report=${json({reportId:id,state:'building',phase:'queued'})}::jsonb,manifest=NULL,lease_until=clock_timestamp()+interval '45 seconds' WHERE id=${id}`);
    const [claimed]=await tx.execute(sql`SELECT * FROM observability.runtime_reports WHERE id=${id}`);return stored(claimed!);
   }
   return stored(row);
  });},
  async renew(id,owner){const rows=await db.execute(sql`UPDATE observability.runtime_reports SET lease_until=clock_timestamp()+interval '45 seconds' WHERE id=${id} AND owner=${owner} AND state='building' RETURNING id`);return rows.length===1;},
  async ensure(request,requestKey,owner,id){return db.transaction(async tx=>{await admitRuntimeReport(tx);await assertRuntimeReportProjects(tx,id,request.projectId);await tx.execute(sql`INSERT INTO observability.runtime_reports(id,request_key,owner,request,state,report) VALUES(${id},${requestKey},${owner},${json(request)}::jsonb,'building',${json({state:'building',reportId:id,phase:'queued'})}::jsonb) ON CONFLICT(request_key) DO NOTHING`);const [row]=await tx.execute(sql`SELECT * FROM observability.runtime_reports WHERE request_key=${requestKey}`);if(!row)throw new Error('Original report request missing');await assertRuntimeReportProjects(tx,String(row['id']),request.projectId);return stored(row);});},
  async phase(id,owner,phase){await db.execute(sql`UPDATE observability.runtime_reports SET report=${json({reportId:id,state:'building',phase})}::jsonb WHERE id=${id} AND owner=${owner} AND state='building'`);},
  stage:(id,owner,page)=>stageReportPage(db,id,owner,page),publish:(id,owner,manifest)=>publishReport(db,id,owner,manifest),
  unavailable:(id,owner,gaps)=>terminal(id,owner,'not-ready',{reportId:id,state:'not-ready',gaps}),
  fail:(id,owner,error)=>terminal(id,owner,'failed',{reportId:id,state:'failed',error,retryable:true}),
  page:(report,query,after)=>db.transaction(async tx=>{await admitRuntimeReport(tx);await assertRuntimeReportProjects(tx,report.id,report.request.projectId);return completeRuntimeReportPage(tx,report,query,after);}),
 };
}
