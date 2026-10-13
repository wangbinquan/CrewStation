// Original classified Tokens stay visible while repeated collection prose is collapsed.
import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {RuntimeTokenMetric} from '../features/observability/components/RuntimeMetrics';
import {Disclosure} from '../shared/ui/Disclosure';
import {messages} from '../features/observability/i18n/zh-CN';
import {renderElement} from './renderElement';
let page:Awaited<ReturnType<typeof renderElement>>|undefined;
afterEach(()=>{page?.unmount();page=undefined;});
const metrics={state:'not-ready' as const,gaps:['usage-missing'],recordedUsage:{executions:'0',observedExecutions:'0',records:'1',tokens:{input:'9007199254740993',cacheRead:'0',cacheWrite:'0',output:'7',total:'9007199254741000'},bucketRecords:{input:'1',cacheRead:'1',cacheWrite:'1',output:'1'}}};
test('repeated rows show original exact numbers and one collapsed status instead of prose paragraphs',async()=>{
 page=await renderElement(<table><tbody>{[1,2,3].map(id=><tr key={id}><td><RuntimeTokenMetric metrics={metrics}/></td></tr>)}</tbody></table>,messages);
 for(const row of page.host.querySelectorAll('tr')){
  expect(row.querySelector('strong')?.textContent).toBe('9,007,199,254,741,000');
  expect([...row.querySelectorAll('[data-token-buckets] dd')].map(node=>node.textContent)).toEqual(['9,007,199,254,740,993','0','0','7']);
  const details=row.querySelector('details')!;expect(details.open).toBe(false);expect(details.querySelector('summary')?.textContent).toBe(messages['runtime.receivedValue']);
  expect(row.textContent).not.toContain('0 / 0');expect(details.textContent).toContain(messages['runtime.reason.usage-missing']);expect(details.textContent).toContain('1');
  expect([...row.querySelectorAll('p')].every(node=>details.contains(node))).toBe(true);
 }
});
test('the shared disclosure defaults to native collapsed semantics without hiding its original content',async()=>{
 page=await renderElement(<Disclosure label="Original collection"><p>Original record</p></Disclosure>,messages);const details=page.host.querySelector('details')!;
 expect(details.open).toBe(false);expect(details.querySelector('summary')?.textContent).toBe('Original collection');expect(details.textContent).toContain('Original record');expect(page.host.querySelector('h1,h2,h3')).toBeNull();
});

test('not-applicable Token rows retain their reason inside the collapsed collection details',async()=>{
 page=await renderElement(<RuntimeTokenMetric metrics={{state:'not-applicable'}}/>,messages);
 expect(page.host.querySelector('strong')?.textContent).toBe('—');const details=page.host.querySelector('details')!;expect(details.open).toBe(false);
 expect(details.querySelector('summary')?.textContent).toBe(messages['runtime.collectionDetails']);expect(details.textContent).toContain(messages['runtime.reason.not-applicable']);
 expect([...page.host.querySelectorAll('p')].every(node=>details.contains(node))).toBe(true);
});
