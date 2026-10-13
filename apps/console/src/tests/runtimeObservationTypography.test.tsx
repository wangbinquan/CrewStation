// Trend buttons and resource-history notes keep their shared observation roles.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act} from 'react';
import {RuntimeTrend} from '../features/observability/components/RuntimeTrend';
import {TimeSeries} from '../shared/ui/TimeSeries';
import {messages} from '../features/observability/i18n/zh-CN';
import {renderElement} from './renderElement';
import type {RuntimeSearch} from '../features/observability/model/runtimeSearch';
let page:Awaited<ReturnType<typeof renderElement>>|undefined,style:HTMLStyleElement|undefined;
afterEach(()=>{page?.unmount();page=undefined;style?.remove();style=undefined;});
async function productionStyle(){
 style=document.createElement('style');
 const tokens=await Bun.file(new URL('../app/theme/tokens.css',import.meta.url)).text(),series=await Bun.file(new URL('../shared/ui/TimeSeries.module.css',import.meta.url)).text(),observation=await Bun.file(new URL('../features/observability/components/RuntimeStatistics.module.css',import.meta.url)).text();
 style.textContent=tokens+series+observation;document.head.appendChild(style);
}
const from='2026-10-01T00:00:00.000Z',to='2026-10-02T00:00:00.000Z',metrics={state:'ready' as const,executions:'10000001',observedExecutions:'10000001',records:'10000001',tokens:{input:'9007199254740993',cacheRead:'0',cacheWrite:'0',output:'7',total:'9007199254741000'},cost:{currency:'CNY' as const,state:'complete' as const,amount:'0.07'}};
test('exact trend values keep the small-text role and original task navigation',async()=>{
 await productionStyle();let next:RuntimeSearch|undefined;
 page=await renderElement(<div className="page"><RuntimeTrend summary={{tasks:'100001',metrics,durations:{state:'complete',samples:'0',p50Ms:null,p95Ms:null,maxMs:null},trend:[{from,to,tasks:'100001',metrics}],sources:[]}} header={{filters:{from,to,timezone:'UTC'}}} search={{tab:'overview'}} change={value=>{next=value;}}/></div>,messages);
 const column=page.host.querySelector<HTMLButtonElement>('.chartColumn')!,value=column.querySelector('.chartValue')!;
 expect(getComputedStyle(column).fontSize).toBe('12px');expect(getComputedStyle(value).whiteSpace).toBe('nowrap');expect(value.textContent).toBe('9,007,199,254,741,000');
 expect(getComputedStyle(page.host.querySelector('.range')!).fontSize).toBe('12px');await act(async()=>column.click());expect(next).toMatchObject({from,to,period:'custom',tab:'tasks'});
});
test('resource-chart dates and inspection output use the same notes role while other TimeSeries callers retain their font',async()=>{
 await productionStyle();const points=[{at:from,average:3,peak:4,coverage:1,complete:true}],labels={average:'Average',peak:'Peak',coverage:'Coverage',select:'Inspect time',gap:'Missing'};
 page=await renderElement(<><div className="page"><div className="resourceCharts"><TimeSeries title="CPU" points={points} format={String} labels={labels}/></div></div><div data-other-series><TimeSeries title="Other CPU" points={points} format={String} labels={labels}/></div></>,messages);
 const chart=page.host.querySelector('.resourceCharts')!;
 expect(getComputedStyle(chart.querySelector('figcaption')!).fontSize).toBe('14px');
 for(const selector of ['figcaption span','time','label','output'])expect(getComputedStyle(chart.querySelector(selector)!).fontSize).toBe('12px');
 expect(getComputedStyle(page.host.querySelector('[data-other-series] label')!).fontSize).toBe('11px');expect(page.text()).toContain('Average: 3');
});
