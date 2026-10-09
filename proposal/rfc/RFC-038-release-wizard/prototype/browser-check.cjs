/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS prototype runner resolves Playwright from its supplied Node runtime. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const baseUrl = process.argv[2];
const outputDir = process.argv[3];
if (!baseUrl || !outputDir) throw new Error('Usage: node browser-check.cjs <local-preview-url> <output-directory>');
const receipt = { artifact: 'RFC-038 design prototype', startedAt: new Date().toISOString(), checks: [], screenshots: [], errors: [], writes: [] };
receipt.sourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'release-wizard.html'))).digest('hex');
fs.mkdirSync(outputDir, { recursive: true });
let browser, lastPage;
function check(name, evidence) { receipt.checks.push({ name, evidence }); }
async function create(width = 1440, colorScheme = 'light') {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme });
  const page = await context.newPage();
  page.on('pageerror', error => receipt.errors.push(error.message));
  page.on('request', request => { if (request.method() !== 'GET') receipt.writes.push({ url: request.url(), method: request.method() }); });
  await page.goto(baseUrl);
  const frame = page.frameLocator('#codex-visualization');
  const root = frame.locator('#cs-release-prototype');
  await root.getByRole('heading', { name: '应用发布', exact: true }).waitFor();
  lastPage = { context, page, frame, root };
  return lastPage;
}
async function screenshot(p, name) {
  const path = `${outputDir}/${name}.png`;
  await p.root.screenshot({ path });
  receipt.screenshots.push(path);
}
async function geometry(p, label) {
  const result = await p.root.evaluate(root => {
    const box = root.getBoundingClientRect();
    const elements = [...root.querySelectorAll('button,input,select,textarea,.rw-steps span,.rw-dl dd')].filter(element => element.getClientRects().length);
    const outside = elements.filter(element => { const r = element.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1; }).map(e => e.textContent?.trim() || e.name);
    const overlap = [...root.querySelectorAll('.rw-steps button')].some((button, index, all) => index && button.getBoundingClientRect().left < all[index - 1].getBoundingClientRect().right - 1);
    return { width: Math.round(box.width), scrollWidth: root.scrollWidth, outside, overlappingSteps: overlap, dialogs: root.querySelectorAll('dialog').length };
  });
  assert.equal(result.outside.length, 0, `${label}: overflow ${result.outside}`);
  assert.equal(result.overlappingSteps, false, `${label}: steps overlap`);
  assert.ok(result.scrollWidth <= result.width + 1, `${label}: root overflow`);
  assert.equal(result.dialogs, 0, `${label}: routine dialog`);
  check(label, result);
}
async function controls(p, patch) {
  const inner = await p.page.frames().find(frame => frame.parentFrame());
  await inner.evaluate(patch => {
    const current = window.openai?.widgetState;
    if (!current?.privateContent?.model) throw new Error('A saved interaction state is needed');
    const snapshot = JSON.parse(JSON.stringify(current));
    Object.assign(snapshot.privateContent.controls, patch);
    window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { widgetState: snapshot } } }));
  }, patch);
}
async function history(p, tag) {
  await p.root.locator('tbody tr').filter({ hasText: tag }).getByRole('button', { name: '查看流程', exact: true }).click();
}
(async () => {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let p = await create();
  await screenshot(p, 'desktop-history-light');
  await geometry(p, '1440px history');
  await history(p, 'v1.4.0');
  await p.root.getByRole('heading', { name: '构建停在这里', exact: true }).waitFor();
  await p.root.getByRole('button', { name: '查看本次日志', exact: true }).click();
  assert.match(await p.root.locator('.rw-log').textContent(), /dist.*not found/);
  await screenshot(p, 'failed-history');
  await p.root.getByRole('button', { name: '完成', exact: false }).click();
  await p.root.getByRole('heading', { name: '这次发布未完成', exact: true }).waitFor();
  assert.equal(await p.root.getByRole('heading', { name: 'v1.4.0 已正式上线', exact: true }).count(), 0);
  check('failed history future steps', 'Viewing completion on a failed process states not completed and does not invent launch');
  await p.root.getByRole('button', { name: '← 返回发布记录', exact: true }).click();
  assert.equal(await p.root.locator('tbody tr').filter({hasText:'v1.4.0'}).getByRole('button', {name:'查看流程',exact:true}).evaluate(el=>el===document.activeElement), true);
  await history(p, 'v1.3.2');
  await p.root.getByRole('button', { name: '构建与部署', exact: false }).click();
  assert.match(await p.root.locator('.rw-step-body').textContent(), /未记录/);
  assert.equal(await p.root.getByRole('button', { name: /^确认上线/ }).count(), 0);
  check('failed and legacy history', 'Per-stage reason and local logs; unknown timestamps; no launch controls');
  await p.context.close();

  p = await create();
  await p.root.getByRole('button', { name: '发布新版本', exact: true }).click();
  await p.root.getByLabel('这次更新了什么（可选）').fill('完善客户分流，修复查询超时');
  await p.root.getByLabel('发布分支', {exact:true}).selectOption('feature/customer-routing');
  assert.match(await p.root.locator('.rw-input-meta').textContent(), /25a401c95d/);
  await p.root.getByLabel('发布来源', {exact:true}).selectOption('session');
  assert.equal(await p.root.getByLabel('当前分支', {exact:true}).inputValue(), 'main');
  assert.equal(await p.root.getByLabel('这次更新了什么（可选）').inputValue(), '完善客户分流，修复查询超时');
  await p.root.getByLabel('发布来源', {exact:true}).selectOption('repository');
  check('source change and return focus', 'Branch changes visible SHA; session pins current branch; note survives; history return restores trigger focus');
  await screenshot(p, 'desktop-prepare-light');
  await geometry(p, '1440px preparation');
  const cta = p.root.getByRole('button', { name: '构建并继续', exact: true });
  await cta.focus(); await cta.press('Enter');
  await p.root.getByRole('heading', { name: '正在构建与部署', exact: true }).waitFor();
  await p.root.getByRole('button', { name: '稍后继续', exact: true }).click();
  assert.equal(await p.root.getByRole('button', { name: '发布新版本', exact: true }).isDisabled(), true);
  await p.root.locator('tbody tr').filter({ hasText: 'v1.4.3' }).getByRole('button', { name: '继续发布', exact: true }).click();
  await p.root.getByRole('heading', { name: '打开这个版本，确认它符合预期', exact: true }).waitFor();
  check('continuous build and resume', 'Enter starts once; same process resumes from history; automatically reaches verification');
  await p.root.getByRole('button', { name: '打开待验证应用 ↗', exact: true }).click();
  assert.match(await p.root.locator('.rw-feedback').textContent(), /仍停留/);
  await p.root.getByLabel('验证说明（可选）').fill('查询和分流已验证');
  await screenshot(p, 'desktop-verification-light');
  await p.root.getByRole('button', { name: '验证通过，继续上线', exact: true }).click();
  await p.root.getByRole('heading', { name: '确认把正式流量交给这个版本', exact: true }).waitFor();
  await controls(p, { role: 'developer' });
  assert.equal(await p.root.getByRole('button', { name: '仅负责人可正式上线', exact: true }).isDisabled(), true);
  await controls(p, { role: 'owner', scenario: 'targetChanged' });
  await p.root.getByRole('button', { name: '确认上线 v1.4.3', exact: true }).click();
  assert.match(await p.root.getByRole('alert').textContent(), /原确认失效/);
  check('permission and stale target', 'Developer cannot launch; target replacement stays in the confirmation step');
  await controls(p, { role: 'owner', scenario: 'normal' });
  await screenshot(p, 'desktop-launch-light');
  await p.root.getByRole('button', { name: '确认上线 v1.4.3', exact: true }).click();
  await p.root.getByRole('heading', { name: '正在完成正式上线', exact: true }).waitFor();
  assert.equal(await p.root.getByRole('heading', { name: 'v1.4.3 已正式上线', exact: true }).count(), 0);
  await p.root.getByRole('heading', { name: 'v1.4.3 已正式上线', exact: true }).waitFor();
  await p.root.getByRole('button', { name: '验证版本', exact: false }).click();
  assert.match(await p.root.locator('.rw-step-body').textContent(), /查询和分流已验证/);
  await p.root.getByRole('button', { name: '← 返回发布记录', exact: true }).click();
  await history(p, 'v1.4.1');
  assert.match(await p.root.locator('.rw-step-body').textContent(), /v1.4.1 已正式上线/);
  assert.match(await p.root.locator('.rw-step-body').textContent(), /后来已被其他版本替换/);
  check('explicit launch and immutable history', 'Request accepted is separate from completion; recorded verification survives; previous success stays success');
  await p.context.close();

  p = await create();
  await p.root.getByRole('button', { name: '发布新版本', exact: true }).click();
  await controls(p, { scenario: 'sourceChanged' });
  await p.root.getByLabel('这次更新了什么（可选）').fill('来源变化时保留这份说明');
  await p.root.getByRole('button', { name: '构建并继续', exact: true }).click();
  assert.match(await p.root.getByRole('alert').textContent(), /版本号与更新说明已保留/);
  assert.equal(await p.root.getByLabel('这次更新了什么（可选）').inputValue(), '来源变化时保留这份说明');
  await controls(p, { scenario: 'buildFail' });
  await p.root.getByRole('button', { name: '构建并继续', exact: true }).click();
  await p.root.getByRole('heading', { name: '构建停在这里', exact: true }).waitFor();
  assert.equal(await p.root.getByRole('button', { name: /^确认上线/ }).count(), 0);
  await p.root.getByRole('button', { name: '修改后发布新版本', exact: true }).click();
  assert.equal(await p.root.getByLabel('版本号', { exact: true }).inputValue(), 'v1.4.4');
  check('source and build failures', 'Draft retained; build error stops delivery; next release uses a new tag and preserves failure');
  await p.context.close();

  for (const width of [1024,390,320]) for (const colorScheme of ['light','dark']) {
    p = await create(width, colorScheme);
    await geometry(p, `${width}px ${colorScheme} history`);
    if ((width===390&&colorScheme==='light') || (width===1024&&colorScheme==='dark')) await screenshot(p, `${width}-${colorScheme}-history`);
    await p.root.getByRole('button', { name: '发布新版本', exact: true }).click();
    await geometry(p, `${width}px ${colorScheme} preparation`);
    if(width===320&&colorScheme==='light')await screenshot(p,'320-light-prepare');
    await p.root.getByRole('button', { name: '← 返回发布记录', exact: true }).click();
    await history(p,'v1.4.1');
    await p.root.getByRole('button', { name: '确认上线', exact:false }).click();
    await geometry(p, `${width}px ${colorScheme} historical launch`);
    await p.context.close();
  }
  assert.equal(receipt.errors.length,0,'Browser script errors');
  assert.equal(receipt.writes.length,0,'Prototype must not submit any network writes');
  check('network and runtime', { scriptErrors: receipt.errors.length, nonGetRequests: receipt.writes.length });
  receipt.completedAt=new Date().toISOString();receipt.result='PASS';
})().catch(async error=>{receipt.result='FAIL';receipt.errors.push(error.stack);process.exitCode=1;
  if(lastPage && !lastPage.page.isClosed()) {
    receipt.failureDom = await lastPage.root.innerText().catch(()=>null);
    receipt.failureState = await lastPage.page.frames().find(frame=>frame.parentFrame()).evaluate(()=>window.openai?.widgetState).catch(()=>null);
    await screenshot(lastPage,'failure-state').catch(()=>{});
  }
}).finally(async()=>{
  if(browser)await browser.close();
  fs.writeFileSync(`${outputDir}/receipt.json`,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({result:receipt.result,checks:receipt.checks.length,errors:receipt.errors,receipt:`${outputDir}/receipt.json`,screenshots:receipt.screenshots.length}));
});
