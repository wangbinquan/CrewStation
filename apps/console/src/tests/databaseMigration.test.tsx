import './domSetup';
import { afterEach,expect,test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { databaseMigrationFixture,operationId,generationId } from './databaseMigrationFixture';
import { projectId,serviceId,userId,prodId } from './releaseDeliveryFixture';
import { migrationIntentKey,readMigrationIntent,saveMigrationIntent } from '../features/release/model/database-migration/intent';
const originalFetch=globalThis.fetch;let page:Awaited<ReturnType<typeof renderApp>>|undefined;
afterEach(()=>{page?.unmount();page=undefined;globalThis.fetch=originalFetch;sessionStorage.clear();});
const list=`/projects/${projectId}/database-migrations`,detail=list+'/'+operationId;
const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(n=>n.textContent===text);
async function type(value:string){const field=document.querySelector<HTMLInputElement>('[role="alertdialog"] input')!;await act(async()=>{field.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new KeyboardEvent('keyup',{key:'a',bubbles:true}));});await page!.settle();}
test('migration last-row detail opens its own route; returning retains the long-list filter',async()=>{
 const f=databaseMigrationFixture();f.state.items=Array.from({length:100},(_,i)=>({...f.op,id:i===99?operationId:Bun.randomUUIDv7() as never}));page=await renderApp(list+'?filter=approved');const rows=document.querySelectorAll('tbody tr');expect(rows.length).toBe(100);
 await act(async()=>{(rows[99]!.querySelector('a,button') as HTMLElement).click();});await page.settle();expect(page.path()).toBe(detail);expect(page.text()).toContain(f.op.candidateTag);expect(document.querySelectorAll('dialog')).toHaveLength(0);await page.click('返回迁移列表');expect(page.path()).toBe(list);expect(page.search().filter).toBe('approved');expect(f.writes).toHaveLength(0);
});
for(const [action,label,confirm] of [['switch','进入维护并迁移','确认进入维护并迁移'],['open','开放并完成','确认开放并完成'],['approve','批准计划','确认批准计划']] as const)test(`${action} shared confirmation pins the current digest and rejects a stale poll`,async()=>{
 const f=databaseMigrationFixture();f.op.actions=[action];f.op.stage=action==='open'?'ready-to-open':action==='approve'?'awaiting-approval':'approved';page=await renderApp(detail);await page.click(label);expect(f.writes).toHaveLength(0);expect(button(confirm)?.disabled).toBe(false);
 f.op.revision++;f.op.confirmationDigest='e'.repeat(64);f.op.plan!.plan.approvalDigest='sha256:'+'f'.repeat(64);await page.reread();expect(button(confirm)?.disabled).toBe(true);expect(page.text()).toContain('确认内容已变化');await page.click('重新核对');expect(button(confirm)?.disabled).toBe(false);await page.click(confirm);
 expect(f.writes[0]).toEqual({path:expect.stringMatching(new RegExp('/'+action+'$')),body:{expectedRevision:6,...(action==='approve'?{approvalDigest:'sha256:'+'f'.repeat(64)}:{confirmationDigest:'e'.repeat(64)})}});expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(0);
});
for(const [word,label,confirm] of [['rollback','回退到原版本','确认回退到原版本'],['abandon','放弃迁移','确认放弃迁移']] as const)test(`${word} requires its typed word and cancel sends no mutation`,async()=>{
 const f=databaseMigrationFixture();f.op.actions=[word];page=await renderApp(detail);await page.click(label);expect(button(confirm)?.disabled).toBe(true);await type('wrong');expect(button(confirm)?.disabled).toBe(true);await page.click('取消');expect(f.writes).toHaveLength(0);await page.click(label);await type(word);expect(button(confirm)?.disabled).toBe(false);await page.click(confirm);expect(f.writes[0]?.body).toEqual({expectedRevision:5});
});
test('members see evidence, generations and plan but no mutation; read errors remove cached actions',async()=>{
 const f=databaseMigrationFixture();f.delivery.state.admin=false;page=await renderApp(detail);expect(page.text()).toContain(f.op.targetGenerationId);expect(button('进入维护并迁移')).toBeUndefined();await page.click('返回迁移列表');expect(button('新建迁移')).toBeUndefined();page.unmount();f.delivery.state.admin=true;page=await renderApp(detail);f.state.readError=true;await page.reread();expect(page.text()).toContain('迁移读取失败');expect(button('进入维护并迁移')).toBeUndefined();expect(f.writes).toHaveLength(0);
});
test('error exposes retry while a progressing stage has no retry button; attempts show failure and receipt digest',async()=>{
 const f=databaseMigrationFixture();f.op.stage='migrating';f.op.actions=['retry','rollback'];f.op.error='迁移 Job 失败';f.op.attempts=[{jobId:operationId,purpose:'database-migration-run',receipt:null,receiptDigest:'sha256:'+'c'.repeat(64),logTail:'original attempt log'}];page=await renderApp(detail);expect(page.text()).toContain('original attempt log');await page.click('重试当前阶段');expect(f.writes[0]?.body).toEqual({expectedRevision:5});f.op.actions=[];f.op.error=null;await page.reread();expect(button('重试当前阶段')).toBeUndefined();
});
test('cancel-rollback uses the shared confirmation, preserves retry and returns to a fresh open confirmation',async()=>{
 const f=databaseMigrationFixture(),label='取消撤回，回到待开放',confirm='确认取消撤回';
 f.op.stage='rolling-back';f.op.actions=['retry','cancel-rollback'];f.op.error='迁移 Job 失败（exit）';f.op.confirmationDigest=null;
 f.op.attempts=[{jobId:operationId,purpose:'database-migration-rollback',receipt:null,receiptDigest:null,logTail:'reverse-migration-required'}];
 page=await renderApp(detail);expect(button('重试当前阶段')?.disabled).toBe(false);expect(button('开放并完成')).toBeUndefined();
 const trigger=button(label)!;trigger.focus();await page.click(label);
 expect(document.querySelectorAll('dialog[role="alertdialog"]')).toHaveLength(1);expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('应用拒绝了撤回');expect(document.querySelectorAll('[role="alertdialog"] input')).toHaveLength(0);expect(f.writes).toHaveLength(0);
  // renderApp.click 使用包含匹配；「确认取消撤回」也含「取消」，这里必须点精确的取消按钮。
  await act(async()=>{button('取消')!.click();});await page.settle();expect(document.querySelectorAll('dialog')).toHaveLength(0);expect(document.activeElement===trigger).toBe(true);expect(page.path()).toBe(detail);expect(f.writes).toHaveLength(0);
 await page.click(label);await act(async()=>{document.querySelector('[role="alertdialog"]')!.dispatchEvent(new Event('cancel',{cancelable:true}));});await page.settle();expect(document.querySelectorAll('dialog')).toHaveLength(0);expect(f.writes).toHaveLength(0);
 await page.click(label);await page.click(confirm);
 expect(f.writes).toEqual([{path:`/v1/services/${serviceId}/database-migrations/${operationId}/cancel-rollback`,body:{expectedRevision:5}}]);expect(document.querySelectorAll('dialog')).toHaveLength(0);expect(button(label)).toBeUndefined();expect(button('重试当前阶段')).toBeUndefined();expect(page.text()).toContain('reverse-migration-required');
 await page.click('开放并完成');expect(document.querySelectorAll('dialog[role="alertdialog"]')).toHaveLength(1);expect(f.writes).toHaveLength(1);await page.click('确认开放并完成');
 expect(f.writes[1]).toEqual({path:`/v1/services/${serviceId}/database-migrations/${operationId}/open`,body:{expectedRevision:6,confirmationDigest:'e'.repeat(64)}});
});
test('cancel-rollback confirmation becomes stale on a new revision or withdrawn action',async()=>{
 const f=databaseMigrationFixture();f.op.stage='rolling-back';f.op.actions=['retry','cancel-rollback'];f.op.error='撤回失败';f.op.confirmationDigest=null;
 page=await renderApp(detail);await page.click('取消撤回，回到待开放');expect(button('确认取消撤回')?.disabled).toBe(false);
 f.op.revision++;await page.reread();expect(button('确认取消撤回')?.disabled).toBe(true);await page.click('重新核对');expect(button('确认取消撤回')?.disabled).toBe(false);
 f.op.actions=['retry'];await page.reread();expect(button('确认取消撤回')?.disabled).toBe(true);await page.click('重新核对');expect(button('确认取消撤回')?.disabled).toBe(true);await act(async()=>{button('取消')!.click();});await page.settle();expect(document.querySelectorAll('dialog')).toHaveLength(0);expect(button('取消撤回，回到待开放')).toBeUndefined();expect(f.writes).toHaveLength(0);
});
test('lost create response retains exact input and UUID across remount; explicit replay clears intent only after matching receipt',async()=>{
 const f=databaseMigrationFixture(),key=migrationIntentKey(serviceId,userId),input={requestId:Bun.randomUUIDv7() as never,expectedActiveGenerationId:generationId as never,expectedActiveReleaseId:prodId as never,branch:'main',expectedCommitSha:'a'.repeat(40)};saveMigrationIntent(sessionStorage,key,input);f.state.loseResponse=true;page=await renderApp(list);expect(f.writes).toHaveLength(0);await page.click('创建迁移目标');expect(f.writes[0]?.body).toEqual(input);expect(readMigrationIntent(sessionStorage,key).intent).toEqual(input);page.unmount();page=await renderApp(list);expect(f.writes).toHaveLength(1);f.state.loseResponse=false;await page.click('创建迁移目标');expect(f.writes[1]?.body).toEqual(input);expect(readMigrationIntent(sessionStorage,key).intent).toBeNull();expect(page.path()).toBe(list+'/'+input.requestId);
});
test('malformed intent blocks creation; mismatched receipt preserves the request for replay',async()=>{
 const f=databaseMigrationFixture(),key=migrationIntentKey(serviceId,userId);sessionStorage.setItem(key,'invalid');page=await renderApp(list);expect(button('新建迁移')?.disabled).toBe(true);expect(page.text()).toContain('无法保存或读取');page.unmount();const input={requestId:Bun.randomUUIDv7() as never,expectedActiveGenerationId:generationId as never,expectedActiveReleaseId:prodId as never,branch:'main',expectedCommitSha:'a'.repeat(40)};saveMigrationIntent(sessionStorage,key,input);f.state.wrongResponse=true;page=await renderApp(list);await page.click('创建迁移目标');expect(page.text()).toContain('回执与原请求不匹配');expect(page.path()).toBe(list);expect(readMigrationIntent(sessionStorage,key).intent).toEqual(input);
});
test('release page exposes migration alongside restore as separate route entries',async()=>{databaseMigrationFixture();page=await renderApp(`/projects/${projectId}/release`);await page.click('数据库迁移');expect(page.path()).toBe(`/admin/integrations/${projectId}/database-migrations`);});
