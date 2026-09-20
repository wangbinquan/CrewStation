// RFC-008 设计附件。所有状态均为内存演示，无网络请求、无真实环境操作。
const byId = (id) => document.getElementById(id);
let scenario = 'outdated', activeWorkspace = 1, nextWorkspace = 2, nextCli = 1;
const workspaces = [{ id: 1, name: '工作区 1' }], terminals = [];
const healthy = () => scenario === 'ready' || scenario === 'empty';
function feedback(message) { byId('feedback').textContent = message; byId('feedback').hidden = false; }
function show(view) {
  document.querySelectorAll('.view').forEach((node) => { node.hidden = node.id !== `view-${view}`; });
  document.querySelectorAll('[data-view]').forEach((node) => node.setAttribute('aria-selected', String(node.dataset.view === view)));
  byId('feedback').hidden = true;
  history.replaceState(null, '', `#${view}`);
}
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => show(button.dataset.view)));
document.querySelectorAll('[role=tablist]').forEach((list) => list.addEventListener('keydown', (event) => {
  const items = [...list.querySelectorAll('[role=tab]')], index = items.indexOf(document.activeElement);
  const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault(); items[next].focus(); items[next].click();
}));
function updateScenario() {
  const ready = healthy(), outdated = scenario === 'outdated', preparing = scenario === 'starting';
  document.body.classList.toggle('has-notice', !ready);
  byId('health').textContent = ready ? '环境就绪' : outdated ? '环境需要更新' : preparing ? '环境准备中' : '环境未连接';
  byId('health').className = `badge ${ready ? 'success' : 'warning'}`;
  byId('connection-notice').hidden = ready; byId('environment-dot').hidden = ready;
  byId('changes-count').hidden = !ready;
  byId('notice-title').textContent = outdated ? '开发环境版本过旧，暂时无法创建开发Agent会话' : preparing ? '正在准备开发环境' : '开发环境暂时未连接';
  byId('notice-body').textContent = outdated ? '旧环境协议为 1，平台要求 2。更新环境后可继续开发，工作文件和未推送提交可保留。' : preparing ? '平台正在准备工作树和运行容器。连接成功后即可创建开发Agent会话，无需手动配置连接地址。' : '页面连接正常，但尚未收到开发环境的连接。检查状态或查看该任务日志，已有草稿会保留。';
  byId('notice-action').textContent = outdated ? '检查并恢复环境' : '查看连接情况';
  byId('empty-title').textContent = ready ? '创建一个开发Agent会话，开始开发' : outdated ? '先恢复开发环境，再开始编写' : preparing ? '环境正在准备，马上开始' : '等待开发环境恢复连接';
  byId('empty-body').textContent = ready ? '选择上方算力档位，启动一个终端后直接输入需求。需要并行开发时，再逐个添加 CLI。' : outdated ? 'CLI 会在已连接的环境中启动。当前环境需要更新，无需手动填写连接地址。' : '连接问题与处理入口始终可见，恢复后可以继续使用这个工作区。';
  byId('empty-action').textContent = ready ? '＋ 创建开发Agent会话' : outdated ? '检查并恢复环境' : '查看连接情况';
  byId('create-cli').disabled = !ready;
  byId('recovery').hidden = !outdated;
  byId('check-badge').textContent = ready ? '环境已连接' : '需要处理 1 项';
  byId('check-badge').className = `badge ${ready ? 'success' : 'warning'}`;
  byId('runner-icon').textContent = ready ? '✓' : '!';
  byId('runner-icon').className = ready ? 'ok' : 'warn';
  byId('runner-detail').textContent = ready ? '已连接，可创建开发Agent会话、读取文件与预览' : outdated ? '连接被拒绝：协议版本 1，平台要求 2' : preparing ? '等待容器启动与自动连接' : '未收到容器连接，原因尚待检查';
  byId('cli-detail').textContent = ready ? '可启动，使用管理员提供的算力档位' : '环境恢复后，可选择算力档位并创建';
  byId('version-summary').textContent = ready ? 'main · 未提交 2 文件 · 未推送 1 提交（演示）' : '工作树状态待环境连接后读取';
  ['preview','comparison'].forEach((name) => { byId(`${name}-offline`).hidden = ready; byId(`${name}-ready`).hidden = !ready; });
  byId('scenario').value = scenario;
  renderWorkspace();
}
function makeButton(text, action, className = '') { const button = document.createElement('button'); button.textContent = text; button.className = className; button.addEventListener('click', action); return button; }
function renderWorkspace() {
  const visible = terminals.filter((item) => item.workspace === activeWorkspace);
  byId('empty').hidden = visible.length > 0; byId('terminal-grid').hidden = visible.length === 0;
  byId('layout-controls').hidden = visible.length === 0;
  byId('terminal-grid').classList.toggle('single', visible.length === 1);
  byId('terminal-grid').replaceChildren(...visible.map(terminalCard));
  byId('roster-count').textContent = String(terminals.length);
  byId('worktabs').replaceChildren(...workspaces.map((workspace) => {
    const count = terminals.filter((item) => item.workspace === workspace.id).length;
    const button = makeButton(`${workspace.name} · ${count}`, () => { activeWorkspace = workspace.id; renderWorkspace(); });
    button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(workspace.id === activeWorkspace));
    return button;
  }));
  const rows = terminals.map((item) => { const row = document.createElement('div'); row.className = 'file-row'; const label = document.createElement('span'); label.textContent = `CLI ${item.id} · ${item.status}`; row.append(label, makeButton('放入当前工作区', () => { item.workspace = activeWorkspace; renderWorkspace(); })); return row; });
  if (!rows.length) { const p = document.createElement('p'); p.textContent = '尚未启动 CLI。创建后可在这里找回收起的窗口。'; rows.push(p); }
  byId('roster').replaceChildren(...rows);
}
function terminalCard(item) {
  const card = document.createElement('article'); card.className = 'terminal';
  const header = document.createElement('div'); header.className = 'terminal-header';
  const title = document.createElement('strong'); title.textContent = `CLI ${item.id}`;
  const badge = document.createElement('span'); badge.className = `badge ${item.status === '需你处理' ? 'warning' : item.status === '本轮完成' ? 'success' : 'neutral'}`; badge.textContent = item.status;
  const spacer = document.createElement('span'); spacer.className = 'grow';
  const profile = document.createElement('span'); profile.className = 'subtle'; profile.textContent = 'GLM-5.2';
  header.append(title, badge, spacer, profile, makeButton('收起', () => { item.workspace = null; renderWorkspace(); }));
  const output = document.createElement('pre'); output.textContent = item.output; output.tabIndex = 0; output.setAttribute('role', 'region'); output.setAttribute('aria-label', `CLI ${item.id} 会话历史，可滚动回看`);
  const form = document.createElement('form'); form.className = 'terminal-input';
  const prompt = document.createElement('span'); prompt.textContent = '›';
  const input = document.createElement('input'); input.setAttribute('aria-label', `CLI ${item.id} 输入`); input.placeholder = '输入开发需求…（演示）'; input.value = item.draft ?? '';
  input.addEventListener('input', () => { item.draft = input.value; });
  const send = makeButton('发送', () => {}); send.type = 'submit';
  form.append(prompt, input, send);
  form.addEventListener('submit', (event) => { event.preventDefault(); if (!input.value.trim()) return; item.output += `\n› ${input.value}\n\n已收到演示输入。真实 CLI 将在此持续显示输出。`; item.draft = ''; item.status = '本轮完成'; renderWorkspace(); });
  card.append(header, output, form); return card;
}
function createCli() {
  if (!healthy()) return;
  terminals.push({ id: nextCli++, workspace: activeWorkspace, status: '等待任务', output: 'OpenCode · GLM-5.2\n\n当前工作树 /work · main\n\n终端已准备好。\n输入你的需求，开始修改应用。\n\n（设计稿中的模拟终端）' });
  renderWorkspace();
}
byId('create-cli').addEventListener('click', createCli);
byId('empty-action').addEventListener('click', () => healthy() ? createCli() : show('session'));
byId('notice-action').addEventListener('click', () => show('session'));
document.querySelectorAll('[data-environment]').forEach((button) => button.addEventListener('click', () => show('session')));
document.querySelectorAll('[data-code]').forEach((button) => button.addEventListener('click', () => show('code')));
byId('add-workspace').addEventListener('click', () => { const id = nextWorkspace++; workspaces.push({ id, name: `工作区 ${id}` }); activeWorkspace = id; renderWorkspace(); });
byId('roster-toggle').addEventListener('click', () => { byId('roster').hidden = !byId('roster').hidden; byId('roster-toggle').setAttribute('aria-expanded', String(!byId('roster').hidden)); });
byId('layout').addEventListener('change', (event) => { byId('terminal-grid').dataset.layout = event.target.value; });
byId('alongside').addEventListener('click', () => { byId('alongside-preview').hidden = !byId('alongside-preview').hidden; byId('alongside').setAttribute('aria-pressed', String(!byId('alongside-preview').hidden)); });
byId('inspect-recovery').addEventListener('click', () => { byId('recovery-confirm').hidden = false; byId('recovery-profile').focus(); });
byId('recovery-profile').addEventListener('change', (event) => { byId('confirm-recovery').disabled = !event.target.value; });
byId('cancel-recovery').addEventListener('click', () => { byId('recovery-confirm').hidden = true; byId('inspect-recovery').focus(); });
byId('confirm-recovery').addEventListener('click', () => { scenario = 'empty'; byId('recovery-confirm').hidden = true; updateScenario(); show('cli'); feedback('演示恢复完成：工作树保留。现在可以逐个创建开发Agent会话。真实实现需要等待新环境握手。'); });
byId('scenario').addEventListener('change', (event) => {
  scenario = event.target.value; terminals.length = 0;
  if (scenario === 'ready') {
    const states = ['执行中', '需你处理', '本轮完成', '等待任务'];
    const texts = ['检查项目结构与入口…\n\n✓ 已读取 src/app.ts\n✓ 已定位页面渲染逻辑\n\n正在调整页面交互。', '需要确认接下来的修改范围。\n\n是否同时更新文档中的使用说明？\n\n在下方输入你的选择。', '修改已完成。\n\n✓ 页面交互已更新\n✓ 表单输入已保留\n\n可以切到预览检查效果。', '终端已准备好。\n\n当前工作树 /work · main\n\n告诉我接下来要完成什么。'];
    states.forEach((status, index) => terminals.push({ id: nextCli++, workspace: activeWorkspace, status, output: `OpenCode · GLM-5.2\n\n${texts[index]}\n\n（设计稿中的模拟终端）` }));
  }
  updateScenario(); show('cli');
});
byId('data-form').addEventListener('input', () => { byId('data-dirty').hidden = false; byId('draft-status').textContent = '草稿已保留在当前页面，切换页签不会丢失。'; });
byId('data-form').addEventListener('submit', (event) => { event.preventDefault(); const fields = new FormData(event.target); byId('data-dirty').hidden = true; byId('data-state').textContent = '待负责人批准'; byId('data-record').querySelector('p').textContent = `${fields.get('mode')} · ${fields.get('ttl')} 分钟 · 待负责人批准（演示记录）`; feedback('演示申请已提交。真实申请会交给项目负责人处理。'); });
byId('source-code').addEventListener('input', () => { byId('code-dirty').hidden = false; });
byId('save-code').addEventListener('click', () => { if (!healthy()) { feedback('环境未连接，真实文件暂不能保存。当前输入仍保留。'); return; } byId('code-dirty').hidden = true; feedback('演示保存成功，未写入任何真实文件。'); });
document.querySelectorAll('[data-log]').forEach((button) => button.addEventListener('click', () => feedback('正式实现将携带当前 taskId 打开“运行与诊断 → 日志”。设计稿未连接真实日志。')));
byId('check-status').addEventListener('click', () => feedback(healthy() ? '演示检查：页面与开发环境均已连接。' : '演示检查：状态未变化；请查看当前环境原因与可用恢复操作。'));
byId('data-refresh').addEventListener('click', () => feedback('演示数据状态已刷新，表单草稿保留。'));
byId('changes-refresh').addEventListener('click', () => feedback('设计稿展示模拟的比较状态，真实实现从当前工作树读取。'));
byId('publish').addEventListener('click', () => feedback('正式实现将进入“发布与上线”，以当前开发会话为源码执行发布前检查。'));
byId('history').addEventListener('click', () => feedback('正式实现进入独立历史对话页，当前 CLI 不会因此结束。'));
byId('release').addEventListener('click', () => feedback('正式实现先检查未保存、未提交与未推送改动，再单独确认释放。本设计稿不会释放环境。'));
byId('sample-send').addEventListener('click', () => feedback('这是开发预览的示意，不会向真实模型发送请求。'));
byId('feedback').addEventListener('click', () => { byId('feedback').hidden = true; });
updateScenario();
if (['cli','preview','code','changes','data','session'].includes(location.hash.slice(1))) show(location.hash.slice(1));
