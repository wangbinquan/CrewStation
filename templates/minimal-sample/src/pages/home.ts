/**
 * 首页 HTML：当前用户（只来自网关请求头）、部署信息、Agent 对话框、最近事件。
 * 所有来自请求头、环境变量与事件信封的值都经 escapeHtml 转义后再拼进页面。
 */
import { MAX_STORED_EVENTS } from '../events/gitlabHandler';
import type { StoredEvent } from '../events/gitlabHandler';
import { CHAT_AGENT_PROFILE } from '../platform/agentClient';
import { CONFIG_ENV, PLATFORM_ENV } from '../platform/environment';
import type { DeploymentInfo } from '../platform/environment';
import { IDENTITY_HEADERS } from '../platform/identity';
import type { GatewayUser } from '../platform/identity';

export interface HomePageModel {
  user: GatewayUser | null;
  deployment: DeploymentInfo;
  events: readonly StoredEvent[];
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

export function renderHomePage(model: HomePageModel): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CrewStation 最小样例</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <h1>CrewStation 最小样例</h1>
  <p class="lead">这个数字人没有任何登录代码：当前用户来自网关注入的请求头，Agent 对话经平台 API 以服务身份发起，事件由 cs-events 推送到 <code>/events/gitlab</code>。</p>
  ${renderUserSection(model.user)}
  ${renderDeploymentSection(model.deployment)}
  ${renderChatSection(model.deployment)}
  ${renderEventsSection(model.events)}
  <footer>身份请求头、配置、内部 API、事件与 Agent 任务的说明以工作台能力页与能力说明 MCP 为准；见 <code>CONTRIBUTING.md</code>。</footer>
</main>
<script>${CHAT_SCRIPT}</script>
</body>
</html>
`;
}

function renderUserSection(user: GatewayUser | null): string {
  if (!user) {
    return `<section id="user" class="warn">
  <h2>当前用户</h2>
  <p><strong>未识别到网关身份。</strong>本页只读取网关注入的 <code>${IDENTITY_HEADERS.userId}</code>、<code>${IDENTITY_HEADERS.userName}</code>、<code>${IDENTITY_HEADERS.userEmail}</code>；直接访问容器端口或在本地运行时没有这些请求头。</p>
</section>`;
  }
  return `<section id="user">
  <h2>当前用户</h2>
  <dl>
    <dt>名称</dt><dd>${escapeHtml(user.name)}</dd>
    <dt>用户 ID</dt><dd><code>${escapeHtml(user.id)}</code></dd>
    <dt>邮箱</dt><dd>${user.email ? escapeHtml(user.email) : '<span class="muted">未提供</span>'}</dd>
  </dl>
</section>`;
}

function renderDeploymentSection(deployment: DeploymentInfo): string {
  return `<section id="deployment">
  <h2>部署信息</h2>
  <dl>
    ${renderEnvRow('部署槽', PLATFORM_ENV.slot, deployment.slot)}
    ${renderEnvRow('环境', PLATFORM_ENV.environment, deployment.environment)}
    ${renderEnvRow('项目', PLATFORM_ENV.project, deployment.project)}
    ${renderEnvRow('服务', PLATFORM_ENV.service, deployment.service)}
    ${renderEnvRow('配置项', CONFIG_ENV.greeting, deployment.greeting)}
  </dl>
</section>`;
}

function renderEnvRow(label: string, envName: string, value: string | null): string {
  const shown = value ? escapeHtml(value) : '<span class="muted">未设置</span>';
  return `<dt>${label} <code>${envName}</code></dt><dd>${shown}</dd>`;
}

function renderChatSection(deployment: DeploymentInfo): string {
  const configured = deployment.platformApiUrl !== null;
  const notice = configured
    ? `<p class="muted">经平台 API <code>${escapeHtml(deployment.platformApiUrl ?? '')}</code> 以本服务身份创建业务任务，运行 Agent 档案 <code>${CHAT_AGENT_PROFILE}</code>；不携带任何凭据。</p>`
    : `<p class="warn-text">未配置 <code>${PLATFORM_ENV.platformApiUrl}</code>，对话不可用；部署到平台或在开发会话中运行时由平台注入。</p>`;
  const disabled = configured ? '' : ' disabled';
  return `<section id="chat">
  <h2>Agent 对话</h2>
  ${notice}
  <form id="chat-form">
    <textarea id="chat-prompt" name="prompt" rows="3" placeholder="输入要发给 Agent 的内容" required${disabled}></textarea>
    <button type="submit"${disabled}>发送</button>
  </form>
  <pre id="chat-output" class="output" aria-live="polite"></pre>
</section>`;
}

function renderEventsSection(events: readonly StoredEvent[]): string {
  const body = events.length === 0
    ? `<p class="muted">尚未收到事件。订阅在 <code>crewstation.yaml</code> 的 <code>spec.subscriptions</code> 声明（<code>gitlab.push</code> → <code>/events/gitlab</code>），平台只向 prod 活动槽推送。</p>`
    : `<table>
    <thead><tr><th>事件类型</th><th>发生时间</th><th>投递 ID</th><th>第几次投递</th><th>traceId</th></tr></thead>
    <tbody>${events.map(renderEventRow).join('')}</tbody>
  </table>`;
  return `<section id="events">
  <h2>最近事件（最多 ${MAX_STORED_EVENTS} 条）</h2>
  ${body}
</section>`;
}

function renderEventRow(event: StoredEvent): string {
  const trace = event.traceId ? `<code>${escapeHtml(event.traceId)}</code>` : '<span class="muted">—</span>';
  return `<tr><td><code>${escapeHtml(event.eventType)}</code></td><td>${escapeHtml(event.occurredAt)}</td><td><code>${escapeHtml(event.deliveryId)}</code></td><td>${event.attempt}</td><td>${trace}</td></tr>`;
}

const STYLES = `
:root { color-scheme: light; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; background: #f6f7f9; color: #1f2328; line-height: 1.5; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 1.5rem; margin: 0 0 8px; }
h2 { font-size: 1.1rem; margin: 0 0 12px; }
.lead, footer { color: #57606a; font-size: 0.95rem; }
section { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; margin: 16px 0; }
section.warn { border-color: #d4a72c; background: #fff8e5; }
.warn-text { color: #9a6700; }
.muted { color: #6e7781; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
dt { color: #57606a; }
dd { margin: 0; overflow-wrap: anywhere; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: #f6f8fa; padding: 1px 4px; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #d8dee4; vertical-align: top; overflow-wrap: anywhere; }
textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 8px; border: 1px solid #d0d7de; border-radius: 6px; }
button { margin-top: 8px; font: inherit; padding: 6px 16px; border: 1px solid #1f883d; border-radius: 6px; background: #1f883d; color: #fff; cursor: pointer; }
button:disabled, textarea:disabled { opacity: 0.5; cursor: not-allowed; }
.output { white-space: pre-wrap; background: #f6f8fa; border-radius: 6px; padding: 12px; min-height: 2.5em; margin: 12px 0 0; }
.output:empty { display: none; }
`;

// 浏览器端脚本不含任何服务端插值；结果只用 textContent 写入，不用 innerHTML。
const CHAT_SCRIPT = `
(function () {
  var form = document.getElementById('chat-form');
  var prompt = document.getElementById('chat-prompt');
  var output = document.getElementById('chat-output');
  var button = form.querySelector('button');
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var text = prompt.value.trim();
    if (!text) return;
    output.textContent = '已提交，等待 Agent 子任务结束…';
    button.disabled = true;
    try {
      var res = await fetch('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: text })
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok) {
        output.textContent = data.text || '（Agent 没有输出）';
      } else {
        output.textContent = '出错：' + (data.error || ('HTTP ' + res.status)) + (data.text ? '\\n\\n部分输出：\\n' + data.text : '');
      }
    } catch (err) {
      output.textContent = '出错：' + (err && err.message ? err.message : String(err));
    } finally {
      button.disabled = false;
    }
  });
})();
`;
