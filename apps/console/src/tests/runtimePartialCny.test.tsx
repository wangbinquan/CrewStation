// Formal metrics render original partial amounts and explicit full/partial coverage in both languages.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {CompleteRuntimeMetricsSchema} from '@crewstation/contracts';
import {RuntimeMetrics} from '../features/observability/components/RuntimeMetrics';
import {messages as zh} from '../features/observability/i18n/zh-CN';
import {messages as en} from '../features/observability/i18n/en-US';
import {renderElement} from './renderElement';
let page:Awaited<ReturnType<typeof renderElement>>|undefined;
afterEach(()=>{page?.unmount();page=undefined;});
function metrics(input='120',amount='0.00012'){return CompleteRuntimeMetricsSchema.parse({state:'not-ready',gaps:['usage-incomplete'],recordedUsage:{executions:'1',observedExecutions:'1',records:'1',tokens:{input,cacheRead:null,cacheWrite:'0',output:null,total:input},bucketRecords:{input:'1',cacheRead:'0',cacheWrite:'1',output:'0'}},costCoverage:{records:'1',pricedRecords:'0',partiallyPricedRecords:'1',visibility:'visible'},recordedCost:{currency:'CNY',amount,records:'1',pricedRecords:'0',partiallyPricedRecords:'1'}});}
test.each([zh,en])('known partial CNY, exclusive record counts and all actual unknown categories are visible',async messages=>{
 page=await renderElement(<RuntimeMetrics metrics={metrics()} tasks="1"/>,messages);expect(page.text()).toContain('¥0.00012');expect(page.text()).not.toContain('$');expect([...page.host.querySelectorAll('[data-token-bucket] dd')].map(node=>node.textContent)).toEqual(['120','—','0','—']);
 const coverage=messages['runtime.partialPricingCoverage'].replace('{priced}','0').replace('{partial}','1').replace('{records}','1');expect(page.text()).toContain(coverage);expect(page.host.querySelectorAll('h2')).toHaveLength(3);
});
test('a real known partial zero displays CNY zero with incomplete pricing instead of an empty amount',async()=>{
 page=await renderElement(<RuntimeMetrics metrics={metrics('0','0')}/>,zh);expect(page.text()).toContain('¥0');expect(page.text()).toContain('完整估值 0 条，部分估值 1 条');expect([...page.host.querySelectorAll('[data-token-bucket] dd')].map(node=>node.textContent)).toEqual(['0','—','0','—']);
});
