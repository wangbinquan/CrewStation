import {jsonHash,newResourceId,forbidden,notFound,precondition} from '@crewstation/kernel';
import {RuntimeStatisticsQuerySchema,RuntimeReportPageQuerySchema,runtimeCompleteReportContent,RUNTIME_REPORT_FACT_SECTIONS,type Actor,type ProjectId,type TaskId,type RuntimeStatisticsQuery,type RuntimeReportPageQuery} from '@crewstation/contracts';
import type {CompleteReportRequest,CompleteReportStored,CompleteReportManifest,CompleteRuntimeReportCache,CompleteReportSpool} from '../../ports/completeRuntimeReportCache';
import type {ProjectAuthorizer} from '../../ports/sources';
import {completeSourceCursor,completeSourcePosition} from '../../domain/completeSourceCursor';
type BuildResult={state:'ready';manifest:CompleteReportManifest}|{state:'not-ready';gaps:readonly {source:string;reason:string}[];manifest?:CompleteReportManifest};
export function completeRuntimeReportUseCases(input:{store:CompleteRuntimeReportCache;spool:CompleteReportSpool;owner:string;authorizer:ProjectAuthorizer;build:(report:CompleteReportStored,signal:AbortSignal)=>Promise<BuildResult>;costVisible:(projectId:ProjectId)=>Promise<boolean>}) {
 const controller=new AbortController(),jobs=new Map<string,Promise<void>>(),cancellations=new Map<string,AbortController>();let tail=Promise.resolve(),paused=0;
 const workerOf=(owner:string)=>owner.split('/')[0];
 async function authorize(actor:Actor,projectId:ProjectId|null) {if(projectId===null){if(!actor.isAdmin)throw forbidden();}else await input.authorizer.authorize(actor,projectId,'view');}
 async function readable(actor:Actor,projectId:ProjectId|null,id:string) {
  await authorize(actor,projectId);const report=await input.store.get(id);
  if(!report||report.request.actor.userId!==actor.userId||report.request.actor.isAdmin!==actor.isAdmin||report.request.projectId!==projectId)throw notFound('完整运行报告不存在');
  const content=runtimeCompleteReportContent(report.report);
  if(content) {
   const identity=await input.store.identity();if(identity.generation!==content.header.generation)throw precondition('原运行数据代次已改变，请刷新报告');
   if(projectId&&content.summary.metrics.state==='ready'&&content.summary.metrics.cost.state!=='hidden'&&!(await input.costVisible(projectId)))throw precondition('项目费用显示配置已改变，请刷新报告');
  }
  return report;
 }
 async function run(report:CompleteReportStored,signal:AbortSignal) {
  try {
   signal.throwIfAborted();await authorize(report.request.actor,report.request.projectId);await input.store.phase(report.id,report.owner,'collecting');
   const result=await input.build(report,signal);
   if(result.state==='not-ready'&&!result.manifest){await input.store.unavailable(report.id,report.owner,result.gaps);return;}
   const manifest=result.manifest;if(!manifest)throw new Error('Original complete report manifest missing');
   // The original read reservation is released before the first staging write, even with pool max=1.
   await input.store.phase(report.id,report.owner,'publishing');
   for await(const page of input.spool.pages(manifest,signal))await input.store.stage(report.id,report.owner,page);
   await authorize(report.request.actor,report.request.projectId);await input.store.publish(report.id,report.owner,manifest);
  }catch(error){await input.store.fail(report.id,report.owner,error instanceof Error?error.message:String(error));}
  finally{await input.spool.remove(report.id,report.owner);}
 }
 function schedule(report:CompleteReportStored) {
  if(paused||controller.signal.aborted||report.state!=='building'||workerOf(report.owner)!==input.owner||jobs.has(report.id))return;
  const cancellation=new AbortController(),stop=()=>cancellation.abort(controller.signal.reason);cancellations.set(report.id,cancellation);controller.signal.addEventListener('abort',stop,{once:true});
  const heartbeat=setInterval(()=>{void input.store.renew(report.id,report.owner).catch(()=>{});},10000);
  const job=tail.then(()=>run(report,cancellation.signal));jobs.set(report.id,job);tail=job.catch(()=>{});
  void job.finally(()=>{clearInterval(heartbeat);jobs.delete(report.id);cancellations.delete(report.id);controller.signal.removeEventListener('abort',stop);}).catch(()=>{});
 }
 async function request(actor:Actor,projectId:ProjectId|null,filters:RuntimeStatisticsQuery,taskId?:TaskId) {
  await authorize(actor,projectId);if(paused||controller.signal.aborted)throw precondition('完整报告正在清理，请稍后刷新');const identity=await input.store.identity(),query=RuntimeStatisticsQuerySchema.parse(filters),request:CompleteReportRequest={actor,projectId,filters:query,...(taskId?{taskId}: {})};
  const requestKey=jsonHash({projectionVersion:2,executionFactsVersion:1,identity,request}),owner=input.owner+'/'+newResourceId();
  const existing=await input.store.ensure(request,requestKey,owner,newResourceId());
  if(existing.state==='failed'&&jobs.has(existing.id))await jobs.get(existing.id);
  const report=jobs.has(existing.id)?existing:await input.store.claim(existing.id,owner);schedule(report);return report.report;
 }
 return {request,
  async status(actor:Actor,projectId:ProjectId|null,id:string){let report=await readable(actor,projectId,id);if(report.state==='building'&&!jobs.has(id))report=await input.store.claim(id,input.owner+'/'+newResourceId());schedule(report);return report.report;},
  async page(actor:Actor,projectId:ProjectId|null,id:string,query:RuntimeReportPageQuery) {
   const report=await readable(actor,projectId,id),content=runtimeCompleteReportContent(report.report);if(!content)throw precondition('完整报告尚未就绪');
   const parsed=RuntimeReportPageQuerySchema.parse(query);if(content.header.coverage==='complete-facts'&&!RUNTIME_REPORT_FACT_SECTIONS.includes(parsed.section))throw precondition('用量原始记录不完整，不能读取数值明细');
   const source=JSON.stringify([id,parsed.section,parsed.parent??null,parsed.rowKey??null]),parent=jsonHash(report.request);
   const after=completeSourcePosition(parsed.after??null,content.header.snapshotId,source,parent)??null;
   if(after!==null&&!/^(0|[1-9]\d*)$/.test(after))throw precondition('报告分页位置无效');
   const page=await input.store.page(report,parsed,after);
   return {...page,nextCursor:page.nextCursor===null?null:completeSourceCursor(page.snapshotId,source,parent,page.nextCursor)};
  },
  deletionLifecycle:{
   async quiesce<T>(work:()=>Promise<T>):Promise<T>{paused++;try{for(const job of cancellations.values())job.abort(new Error('Runtime report cache is being cleared'));await tail;return await work();}finally{paused--;}},
   clear:()=>input.spool.clear(),empty:()=>input.spool.empty(),
  },
  worker:{start(){},async drain(){await tail;},async stop(){controller.abort(new Error('Runtime report process stopped'));await tail;}},
 };
}
