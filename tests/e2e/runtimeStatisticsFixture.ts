import {RuntimeCompleteReportSchema,RuntimeReportSectionSchema,type RuntimeCompleteReport,type RuntimeReportSection} from '../../packages/contracts';
import type { Page } from './cdp';
import { runtimeStatisticsFixture } from '../../apps/console/src/tests/runtimeStatisticsFixture';

type ArchivedPage={reportId:string;snapshotId:string;section:RuntimeReportSection;parent:string|null;total:string;items:Record<string,unknown>[]};
type Archive={responses:Record<string,unknown>;pages:Record<string,ArchivedPage>};
const pageKey=(path:string,section:string,parent:string|null)=>JSON.stringify([path,section,parent]);
async function archivePages(archive:Archive,path:string,report:Extract<RuntimeCompleteReport,{state:'ready'}>,section:RuntimeReportSection,parent:string|null) {
 const items:Record<string,unknown>[]=[];let after:string|null=null,total:string|undefined;
 do {
  const query=new URLSearchParams({section,pageSize:'100'});if(parent!==null)query.set('parent',parent);if(after!==null)query.set('after',after);
  const response=await fetch(path+'/pages?'+query),page=await response.json() as ArchivedPage&{nextCursor:string|null};
  if(!response.ok||page.reportId!==report.header.reportId||page.snapshotId!==report.header.snapshotId||page.section!==section||page.parent!==parent||total!==undefined&&page.total!==total)throw new Error('Fixture original page identity changed');
  total=page.total;items.push(...page.items);
  if(page.nextCursor!==null&&(page.nextCursor===after||page.items.length===0))throw new Error('Fixture original cursor did not advance');
  after=page.nextCursor;
 }while(after!==null);
 if(BigInt(items.length)!==BigInt(total??'0'))throw new Error('Fixture original page count incomplete');
 const value={reportId:report.header.reportId,snapshotId:report.header.snapshotId,section,parent,total:total??'0',items};
 archive.pages[pageKey(path,section,parent)]=value;return items;
}
async function archiveReport(archive:Archive,alias:string,query:string) {
 const response=await fetch(alias+(query?'?'+query:'')),report=RuntimeCompleteReportSchema.parse(await response.json());
 if(!response.ok||report.state!=='ready')throw new Error('Layout fixture requires a complete ready report');
 const path=alias.split('/observability/')[0]+'/observability/reports/'+report.header.reportId;
 archive.responses[alias]=report;archive.responses[path]=report;
 const global=new Map<RuntimeReportSection,Record<string,unknown>[]>();
 for(const section of RuntimeReportSectionSchema.options)global.set(section,await archivePages(archive,path,report,section,null));
 for(const task of global.get('tasks')??[])for(const section of ['attempts','swimlane','calls'] as const)await archivePages(archive,path,report,section,String(task['id']));
 for(const agent of global.get('agents')??[])await archivePages(archive,path,report,'agent-tasks',String(agent['key']));
 for(const profile of global.get('profiles')??[])await archivePages(archive,path,report,'profile-tasks',String(profile['key']));
 for(const attempt of global.get('attempts')??[])for(const section of ['captures','native-pages'] as const)await archivePages(archive,path,report,section,String(attempt['key']));
}

/** Only layout uses fixtures; the preceding endpoint test reads the deployed original report. */
export async function installRuntimeStatisticsFixture(page: Page) {
 const original=globalThis.fetch,f=runtimeStatisticsFixture(),archive:Archive={responses:{},pages:{}};
 try {
  for(const path of ['/v1/me','/v1/projects','/v1/projects/page','/v1/projects/'+f.projectId])archive.responses[path]=await (await fetch(path)).json();
  await archiveReport(archive,'/v1/admin/observability/statistics',f.query);
  await archiveReport(archive,'/v1/projects/'+f.projectId+'/observability/statistics',f.query);
  for(const task of f.details)await archiveReport(archive,'/v1/admin/observability/tasks/'+task.id,'');
 }finally{globalThis.fetch=original;}
 const source=String.raw`(() => {
  const archive=${JSON.stringify(archive)},original=window.fetch.bind(window);
  window.fetch=async(input,init)=>{
   const url=new URL(typeof input==='string'?input:input.url,location.origin);
   if(!url.pathname.startsWith('/v1/'))return original(input,init);
   if((init?.method??'GET')!=='GET')throw new Error('Observation fixture permits reads only');
   const match=url.pathname.match(/\/observability\/reports\/([^/]+)\/pages$/);
   if(match){
    const section=url.searchParams.get('section'),parent=url.searchParams.get('parent'),rowKey=url.searchParams.get('rowKey'),after=url.searchParams.get('after'),size=Number(url.searchParams.get('pageSize')??100);
    const full=archive.pages[JSON.stringify([url.pathname.slice(0,-6),section,parent])];
    if(!full||![1,100].includes(size)||after!==null&&!/^fixture-\d+$/.test(after))throw new Error('Unknown immutable report page request: '+url.pathname+url.search);
    const selected=rowKey===null?full.items:full.items.filter(row=>String(row.key??row.id??row.projectId??row.modelRef)===rowKey),offset=after===null?0:Number(after.slice(8)),items=selected.slice(offset,offset+size);
    return Response.json({...full,total:String(selected.length),items,nextCursor:offset+items.length<selected.length?'fixture-'+(offset+items.length):null});
   }
   if(url.pathname.includes('/observability/statistics')&&(url.searchParams.get('from')!==${JSON.stringify(f.from)}||url.searchParams.get('to')!==${JSON.stringify(f.to)}||[...url.searchParams.keys()].some(key=>!['from','to','timezone'].includes(key))))throw new Error('Unknown statistical cohort request');
   const value=archive.responses[url.pathname];
   if(value===undefined)throw new Error('Unknown fixture request: '+url.pathname+url.search);
   return Response.json(value);
  };
 })()`;
 await page.cmd('Page.addScriptToEvaluateOnNewDocument',{source});
 return {projectId:f.projectId,taskId:f.details[0]!.id,query:f.query};
}

export async function measureRuntimeOverview(page: Page) {
  return page.eval<{ overflow: number; mainOverflow: number; gap: number; expectedGap: number; sectionGap: number; expectedSectionGap: number; bars: number; chartOverflow: number; tokenLabels: string[]; tokenBuckets: string[]; bucketPairsAligned: boolean; stackPercent: string[]; alignedRange: boolean; noExport: boolean }>(`(() => {
    const grid = document.querySelector('[data-runtime-metrics]'), cards = [...grid.children];
    const a = cards[0].getBoundingClientRect(), b = cards[1].getBoundingClientRect();
    const chart = document.querySelector('[data-runtime-statistics] [role="tabpanel"] [role="group"]');
    const rect = chart.getBoundingClientRect(), bars = [...chart.querySelectorAll('button')];
    const main = document.querySelector('main'), trend = chart.closest('section');
    const input = document.querySelector('input[type="datetime-local"]'), row = input.closest('label').parentElement, apply = row.querySelector('button');
    const tokenRows = [...grid.querySelector('[data-token-buckets]').children], segments = [...bars[0].querySelectorAll('[data-token-bucket]')];
    const bucketPairsAligned = tokenRows.every(row => {const a=row.querySelector('dt').getBoundingClientRect(), b=row.querySelector('dd').getBoundingClientRect();return Math.abs((a.top+a.height/2)-(b.top+b.height/2))<1 && b.left>=a.right});
    const alignedRange = getComputedStyle(row).alignItems === 'flex-end' && (innerWidth < 800 || Math.abs(input.getBoundingClientRect().bottom-apply.getBoundingClientRect().bottom)<1);
    return {overflow:document.documentElement.scrollWidth-innerWidth,mainOverflow:main.scrollWidth-main.clientWidth,
      gap:Math.abs(a.top-b.top)<1 ? b.left-a.right : b.top-a.bottom,
      sectionGap:trend.getBoundingClientRect().top-grid.getBoundingClientRect().bottom,
      expectedSectionGap:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cs-space-3')),
      expectedGap:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cs-space-4')),
      bars:bars.length,chartOverflow:Math.max(0,...bars.map(bar=>bar.getBoundingClientRect().right-rect.left-chart.parentElement.scrollWidth)),
      tokenLabels:bars.map(bar=>bar.firstElementChild.textContent),tokenBuckets:tokenRows.map(row=>row.querySelector('dd').textContent),bucketPairsAligned,stackPercent:segments.map(segment=>segment.style.height),alignedRange,noExport:![...document.querySelectorAll('button')].some(b=>/CSV/.test(b.textContent))};
  })()`);
}
