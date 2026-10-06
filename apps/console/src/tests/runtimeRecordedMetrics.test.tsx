// Received Token/CNY values must render on the formal components even with a usage gap.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act} from 'react';
import {RuntimeCompleteReportSchema,runtimeCompleteReportContent} from '@crewstation/contracts';
import {RuntimeMetrics} from '../features/observability/components/RuntimeMetrics';
import {RuntimeTrend} from '../features/observability/components/RuntimeTrend';
import {RuntimeReportState} from '../features/observability/components/RuntimeReportState';
import {messages as zh} from '../features/observability/i18n/zh-CN';
import {messages as en} from '../features/observability/i18n/en-US';
import type {RuntimeSearch} from '../features/observability/model/runtimeSearch';
import {renderElement} from './renderElement';
let page:Awaited<ReturnType<typeof renderElement>>|undefined;
afterEach(()=>{page?.unmount();page=undefined;});
const from='2026-10-03T00:00:00.000Z',to='2026-10-04T00:00:00.000Z',reportId=Bun.randomUUIDv7();
const metrics={state:'not-ready' as const,gaps:['usage-missing'],recordedUsage:{executions:'2',observedExecutions:'1',records:'1',tokens:{input:'80',cacheRead:null,cacheWrite:'0',output:'7',total:'87'},bucketRecords:{input:'1',cacheRead:'0',cacheWrite:'1',output:'1'}},costCoverage:{records:'1',pricedRecords:'0',partiallyPricedRecords:'1',visibility:'visible' as const},recordedCost:{currency:'CNY' as const,amount:'0.25',records:'1',pricedRecords:'0',partiallyPricedRecords:'1'}};
const report=()=>RuntimeCompleteReportSchema.parse({reportId,state:'not-ready',gaps:[{source:'original',reason:'usage-missing'}],facts:{header:{reportId,projectionVersion:2,scope:'system',projectId:null,filters:{from,to,timezone:'UTC'},asOf:to,snapshotId:'original-snapshot',generation:'1',sourceRevision:'1',coverage:'complete-facts',buildMs:1},summary:{tasks:'2',metrics,durations:{state:'complete',samples:'2',p50Ms:'1',p95Ms:'1',maxMs:'1'},trend:[{from,to,tasks:'2',metrics}],sources:[]}}});
test.each([zh,en])('received categories and CNY remain visible with their own short incomplete coverage',async messages=>{
 page=await renderElement(<RuntimeMetrics metrics={metrics} tasks="2"/>,messages);
 expect([...page.host.querySelectorAll('[data-token-bucket] dd')].map(row=>row.textContent)).toEqual(['80','—','0','7']);expect(page.text()).toContain('87');expect(page.text()).toContain('¥0.25');expect(page.text()).toContain(messages['runtime.receivedValue']);
});
test('received trend uses four classification segments and exact number without changing the actual interval navigation',async()=>{
 const data=runtimeCompleteReportContent(report())!;let changed:RuntimeSearch|undefined;
 page=await renderElement(<RuntimeTrend summary={data.summary} header={data.header} search={{tab:'overview'}} change={next=>{changed=next;}}/>,zh);
 const bar=page.host.querySelector('[data-positive="true"]')!;expect(bar).not.toBeNull();expect(bar.getAttribute('data-partial')).toBe('true');expect(bar.querySelectorAll('[data-token-bucket]')).toHaveLength(4);expect(page.text()).toContain('87');
 const button=page.host.querySelector<HTMLButtonElement>('[aria-label="任务与 Token 趋势"] button')!;expect(button.getAttribute('aria-label')).toContain('80');expect(button.getAttribute('aria-label')).toContain('—');await act(async()=>button.click());expect(changed).toMatchObject({from,to,tab:'tasks'});
});
test('a sealed report uses a compact overview status and never repeats a large gap card on other pages',async()=>{
 page=await renderElement(<RuntimeReportState report={report()}/>,zh);expect(page.text()).toBe('');page.unmount();
 page=await renderElement(<RuntimeReportState report={report()} compact/>,zh);expect(page.host.querySelector('h2')).toBeNull();expect(page.host.querySelector('[role="status"]')).not.toBeNull();expect(page.text()).toContain('Token 用量存在缺口');
});
