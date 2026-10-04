// A whole usage gap must preserve independently qualified original scopes without claiming a complete aggregate.
import {describe,expect,test} from 'bun:test';
import {RUNTIME_REPORT_FACT_SECTIONS,type RuntimeCompleteSummary,type RuntimeReportSection} from '@crewstation/contracts';
import {completeRuntimeFactSummary,completeRuntimeFactRow,assertCompleteRuntimeFactItem} from './completeReportFacts';
import type {CompleteReportOutputRow,CompleteReportTransferItem} from './completeReportEnvelope';
const missing={state:'not-ready' as const,gaps:['native-capture-incomplete']};
const ready={state:'ready' as const,tokens:{input:'80',cacheRead:'3',cacheWrite:'5',output:'7',total:'95'},executions:'1',observedExecutions:'1',records:'1',cost:{currency:'CNY' as const,state:'complete' as const,amount:'0.25'}};
const row=(section:RuntimeReportSection,document:unknown):CompleteReportOutputRow=>({section,parent:'original-task',key:'original-row',document});
describe('sealed fact-only contract boundary',()=>{
 test('ordinary Tasks preserve their independent ready, not-applicable and missing metrics without rewriting the source',()=>{
  for(const metrics of [ready,{state:'not-applicable' as const},missing]) {
   const original={...row('tasks',{id:'original-task',metrics}),parent:null},facts=completeRuntimeFactRow(original,missing.gaps)!;
   expect(facts).toBe(original);expect(facts.document).toBe(original.document);assertCompleteRuntimeFactItem({kind:'row',row:facts});
  }
 });
 test('ordinary Task qualification rejects bad four-bin totals and leaked unknown values',()=>{
  for(const metrics of [{...ready,tokens:{...ready.tokens,total:'94'}},{state:'not-applicable',tokens:ready.tokens},{...missing,tokens:ready.tokens},{...missing,cost:ready.cost},{...ready,cost:{...ready.cost,currency:'USD'}},undefined]) {
   const original={...row('tasks',{id:'original-task',metrics}),parent:null};
   expect(()=>completeRuntimeFactRow(original,missing.gaps)).toThrow();expect(()=>assertCompleteRuntimeFactItem({kind:'row',row:original})).toThrow('child subtotals');
  }
 });
 test('known population and duration survive while each trend and source retains its own qualification',()=>{
  const summary:RuntimeCompleteSummary={tasks:'9007199254740993',metrics:missing,durations:{state:'complete',samples:'9007199254740993',p50Ms:'10000',p95Ms:'20000',maxMs:'30000'},trend:[{from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z',tasks:'9007199254740993',metrics:ready}],sources:[{kind:'business-task',tasks:'9007199254740993',metrics:ready,collectionState:'available'}]};
  const facts=completeRuntimeFactSummary(summary);expect(facts.tasks).toBe(summary.tasks);expect(facts.durations).toEqual(summary.durations);expect(facts.trend[0]!.tasks).toBe(summary.tasks);expect(facts.sources[0]!.tasks).toBe(summary.tasks);expect([facts.metrics,facts.trend[0]!.metrics,facts.sources[0]!.metrics]).toEqual([missing,ready,ready]);expect(summary.trend[0]!.metrics).toEqual(ready);
  expect(()=>completeRuntimeFactSummary({...summary,metrics:ready})).toThrow('incomplete usage');
 });
 test('every allowed original identity, task count, time and independently qualified scope stays intact',()=>{
  const document={taskId:'original-task',name:'Original Name',attemptCount:'10001',durationMs:'10000',metrics:ready},quality={taskId:'original-task',taskName:'Original Name',reason:missing.gaps[0]};
  for(const section of RUNTIME_REPORT_FACT_SECTIONS){const original=row(section,section==='quality'?quality:document),facts=completeRuntimeFactRow(original,missing.gaps)!;expect(facts).toBe(original);expect(facts.document).toEqual(section==='quality'?quality:document);assertCompleteRuntimeFactItem({kind:'row',row:facts});expect(original.document).toEqual(section==='quality'?quality:document);assertCompleteRuntimeFactItem({kind:'count',section,parent:null,total:'9007199254740993'});}
  for(const section of ['models','calls','captures'] as const){expect(completeRuntimeFactRow(row(section,document),missing.gaps)).toBeNull();expect(()=>assertCompleteRuntimeFactItem({kind:'count',section,parent:null,total:'1'})).toThrow('numeric collections');}
  const receipt:CompleteReportTransferItem={kind:'receipt',key:'original-task',document:{count:'9007199254740993',eof:true}};assertCompleteRuntimeFactItem(receipt);expect(receipt.document).toEqual({count:'9007199254740993',eof:true});
 });
 test('missing or malformed original fact rows fail rather than silently disappear',()=>{
  for(const document of [null,undefined,'bad',[],1]){expect(()=>completeRuntimeFactRow(row('tasks',document),missing.gaps)).toThrow('malformed');expect(()=>assertCompleteRuntimeFactItem({kind:'row',row:row('tasks',document)})).toThrow('malformed');}
  expect(()=>completeRuntimeFactRow(row('tasks',{id:'original-task'}),missing.gaps)).toThrow('metrics missing');expect(()=>assertCompleteRuntimeFactItem({kind:'row',row:row('tasks',{id:'original-task'})})).toThrow('child subtotals');
 });
 test('not-ready values with leaked complete totals are rejected at every retained original spool boundary',()=>{
  for(const metrics of [{...missing,tokens:ready.tokens},{...missing,cost:ready.cost},{...missing,executions:'1'},{...missing,gaps:'bad'}])for(const section of ['tasks','quality'] as const)expect(()=>assertCompleteRuntimeFactItem({kind:'row',row:row(section,{taskId:'original-task',metrics})})).toThrow('child subtotals');
 });
});
