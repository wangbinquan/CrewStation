import './domSetup';
import {afterEach,expect,test} from 'bun:test';
import {act} from 'react';
import {renderApp} from './renderApp';
import {databaseRestoreFixture,operationId,generationId} from './databaseRestoreFixture';
import {projectId,serviceId,targetId,userId,prodId} from './releaseDeliveryFixture';
import {restoreIntentKey,readRestoreIntent,saveRestoreIntent} from '../features/release/model/restoreIntent';
const originalFetch=globalThis.fetch;let page:Awaited<ReturnType<typeof renderApp>>|undefined;
afterEach(()=>{page?.unmount();page=undefined;globalThis.fetch=originalFetch;sessionStorage.clear();});
const list=`/projects/${projectId}/database-restores`,detail=list+'/'+operationId;
const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===text);
test('restore detail is a separate deep link; back restores the list filter without a modal overlay',async()=>{
 const f=databaseRestoreFixture();f.state.items=Array.from({length:100},(_,i)=>({...f.op,id:i===0?f.op.id:Bun.randomUUIDv7() as never}));
 page=await renderApp(list+'?filter=ready-to-switch');expect(document.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(100);await page.click('查看详情');
 expect(page.path()).toBe(detail);expect(document.querySelectorAll('dialog')).toHaveLength(0);expect(page.text()).toContain('backup-original');await page.click('返回恢复列表');expect(page.path()).toBe(list);expect(page.search().filter).toBe('ready-to-switch');expect(f.writes).toHaveLength(0);
});
test('switch requires an explicit confirmation of the current digest; stale polling and read failure disable it',async()=>{
 const f=databaseRestoreFixture();page=await renderApp(detail);await page.click('切换到恢复数据库');expect(f.writes).toHaveLength(0);expect(button('确认维护并切换')?.disabled).toBe(false);
 f.op.revision++;f.op.confirmationDigest='e'.repeat(64);await page.reread();expect(button('确认维护并切换')?.disabled).toBe(true);expect(page.text()).toContain('确认内容已变化');await page.click('重新核对');expect(button('确认维护并切换')?.disabled).toBe(false);
 await page.click('确认维护并切换');expect(f.writes[0]!.body).toEqual({expectedRevision:6,confirmationDigest:'e'.repeat(64)});expect(document.querySelectorAll('dialog')).toHaveLength(0);
});
test('admin revocation and unreadable detail remove actions even if an old response is cached',async()=>{
 const f=databaseRestoreFixture();page=await renderApp(detail);f.state.readError=true;await page.reread();expect(button('切换到恢复数据库')).toBeUndefined();expect(page.text()).toContain('原恢复读取失败');f.state.readError=false;f.delivery.state.admin=false;await page.reread();expect(page.text()).toContain('只有平台管理员');expect(f.writes).toHaveLength(0);
});
test('lost create response survives refresh with the same input and UUID; no automatic duplicate is submitted',async()=>{
 const f=databaseRestoreFixture(),key=restoreIntentKey(serviceId,userId),input={requestId:Bun.randomUUIDv7() as never,expectedActiveGenerationId:generationId as never,expectedActiveReleaseId:prodId as never,restoreReleaseId:targetId as never,backupReference:'backup-original'};
 saveRestoreIntent(sessionStorage,key,input);f.state.loseResponse=true;page=await renderApp(list);expect(f.writes).toHaveLength(0);await page.click('创建独立恢复目标');expect(f.writes[0]!.body).toEqual(input);expect(readRestoreIntent(sessionStorage,key).intent).toEqual(input);
 page.unmount();page=await renderApp(list);expect(f.writes).toHaveLength(1);f.state.loseResponse=false;await page.click('创建独立恢复目标');expect(f.writes[1]!.body).toEqual(input);expect(readRestoreIntent(sessionStorage,key).intent).toBeNull();expect(page.path()).toBe(list+'/'+input.requestId);
});
test('session storage errors and malformed durable input block submission without inventing another ID',async()=>{
 databaseRestoreFixture();sessionStorage.setItem(restoreIntentKey(serviceId,userId),'invalid');page=await renderApp(list);expect(page.text()).toContain('无法安全保存或读取');expect(button('新建恢复')?.disabled).toBe(true);
 expect(readRestoreIntent({getItem:()=>{throw new Error('disabled');}},'request')).toMatchObject({intent:null,error:'release.restore.intentUnavailable'});
});
test('unsubmitted form input is preserved behind the shared navigation guard',async()=>{
 const f=databaseRestoreFixture();page=await renderApp(list);await page.click('新建恢复');const field=document.querySelector<HTMLInputElement>('dialog input')!;
 await act(async()=>{field.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,'draft-backup');field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new KeyboardEvent('keyup',{key:'a',bubbles:true}));});await page.settle();
 await page.click('取消');await page.click('新建恢复');expect(document.querySelector<HTMLInputElement>('dialog input')?.value).toBe('draft-backup');await page.click('取消');await page.requestNavigate(`/projects/${projectId}/release`);expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);expect(page.path()).toBe(list);expect(f.writes).toHaveLength(0);
});

test('a mismatched creation receipt retains the original request and never navigates to a different operation',async()=>{
 const f=databaseRestoreFixture(),key=restoreIntentKey(serviceId,userId),input={requestId:Bun.randomUUIDv7() as never,expectedActiveGenerationId:generationId as never,expectedActiveReleaseId:prodId as never,restoreReleaseId:targetId as never,backupReference:'backup-original'};
 saveRestoreIntent(sessionStorage,key,input);f.state.wrongResponse=true;page=await renderApp(list);await page.click('创建独立恢复目标');
 expect(page.path()).toBe(list);expect(readRestoreIntent(sessionStorage,key).intent).toEqual(input);expect(page.text()).toContain('回执与原请求不匹配');expect(f.writes).toHaveLength(1);
});

test('project viewers can read restore history while all administrative mutations remain absent',async()=>{
 const f=databaseRestoreFixture();f.delivery.state.admin=false;page=await renderApp(detail);
 expect(page.text()).toContain('backup-original');expect(button('切换到恢复数据库')).toBeUndefined();expect(button('继续原恢复')).toBeUndefined();
 await page.click('返回恢复列表');expect(button('新建恢复')).toBeUndefined();expect(f.writes).toHaveLength(0);
});

test('production restore list never labels the active development database as current production',async()=>{
 const f=databaseRestoreFixture();page=await renderApp(list);
 expect(page.text()).toContain('生产数据库世代');expect(page.text()).toContain(generationId);
 expect(page.text()).not.toContain('01a1428f-eabe-7000-af4c-887037988564');
 expect(page.text().match(/当前生产/g)).toHaveLength(1);expect(f.writes).toHaveLength(0);
});
