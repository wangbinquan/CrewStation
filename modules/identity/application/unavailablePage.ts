import type { OfflineReason } from '@crewstation/contracts';
import { brandMarkDataUrl } from '../domain/brandMark';
import type { ServiceEntryVerdict } from '../ports/serviceEntry';

export interface UnavailablePageInput {
  readonly entry: Exclude<ServiceEntryVerdict, { kind: 'open' }>;
  /** 工作台首页，作为始终可用的返回路径。 */
  readonly consoleUrl: string;
  readonly now: Date;
}

const OFFLINE_REASON: Record<OfflineReason, string> = {
  manual: '负责人手动下线',
  'rollback-expired': '切流后的回退保留期已满，平台自动下线',
  idle: '长期无人访问，平台自动下线',
  cluster: '平台管理员在集群管理中下线',
};

/**
 * RFC-021 的两张 503 页：正式版本维护中（原因、预计恢复时间，M13），待命槽上没有版本（何时因何下线，B6）。
 * 配色、结构与无权访问页同源，跟随系统明暗；时间先以 UTC 写出，页面脚本再换成浏览器本地时间。
 */
export function renderUnavailablePage({ entry, consoleUrl, now }: UnavailablePageInput): string {
  const body = entry.kind === 'maintenance' ? maintenanceBody(entry, now) : notDeployedBody(entry);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${entry.kind === 'maintenance' ? '正在维护' : '未部署待验证版本'} · CrewStation</title>
<link rel="icon" type="image/svg+xml" href="${brandMarkDataUrl}">
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f7fa; color: #182438; margin: 0; padding: 24px; }
  main { max-width: 480px; margin: 8vh auto; background: #fff; border: 1px solid #dce3ed; border-radius: 12px; padding: 28px; }
  h1 { display: flex; align-items: center; gap: 10px; font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 16px; margin: 16px 0 8px; overflow-wrap: anywhere; }
  .reason { background: #eef3ff; border: 1px solid #b7c8f5; color: #1f3f86; border-radius: 8px; padding: 10px 12px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
  p { font-size: 14px; line-height: 1.6; color: #59677c; }
  a.back { display: inline-block; margin-top: 12px; padding: 8px 14px; border-radius: 6px; background: #235bd8; color: #fff; text-decoration: none; font-size: 14px; }
  a.back:hover { background: #1c4db8; }
  :focus-visible { outline: 2px solid #8db3ff; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) {
    body { background: #11151c; color: #e7edf6; }
    main { background: #191f29; border-color: #344154; }
    .reason { background: #1c2740; border-color: #34497a; color: #b9ccff; }
    p { color: #adbacd; }
    a.back { background: #3970df; }
    a.back:hover { background: #4d84ee; }
  }
</style>
</head>
<body>
<main>
  <h1><img src="${brandMarkDataUrl}" alt="" width="40" height="40">CrewStation</h1>
${body}
  <a class="back" href="${escapeHtml(consoleUrl)}">返回工作台</a>
</main>
<script>
for (const node of document.querySelectorAll('time[datetime]')) {
  const at = new Date(node.getAttribute('datetime'));
  if (!Number.isNaN(at.getTime())) node.textContent = at.toLocaleString();
}
</script>
</body>
</html>
`;
}

function maintenanceBody(entry: Extract<ServiceEntryVerdict, { kind: 'maintenance' }>, now: Date): string {
  const end = entry.expectedEndAt;
  const eta = !end
    ? '<p>负责人没有给出预计恢复时间。</p>'
    : `<p>预计恢复时间：${timeTag(end)}${Date.parse(end) <= now.getTime() ? '（已超过预计时间，维护仍在进行）' : ''}</p>`;
  return `  <h2>${escapeHtml(entry.projectSlug)} 正在维护</h2>
  <p class="reason">${escapeHtml(entry.reason)}</p>
  ${eta}
  <p>维护期间只有项目成员、平台管理员和负责人临时指定的人可以访问。维护结束后刷新即可。</p>`;
}

function notDeployedBody(entry: Extract<ServiceEntryVerdict, { kind: 'not-deployed' }>): string {
  const offline = entry.offline;
  const what = offline
    ? `<p class="reason">${escapeHtml(offline.tag ?? '待验证版本')} 已于 ${timeTag(offline.at)} 下线：${OFFLINE_REASON[offline.reason]}。</p>`
    : '<p class="reason">这个项目的待命槽上还没有部署任何版本。</p>';
  return `  <h2>${escapeHtml(entry.projectSlug)} 当前没有待验证版本</h2>
  ${what}
  <p>项目负责人可以在工作台的「发布与上线」页从发布记录重新部署这个版本，或者发布一个新版本。</p>`;
}

function timeTag(iso: string): string {
  const at = new Date(iso);
  const text = Number.isNaN(at.getTime()) ? iso : `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return `<time datetime="${escapeHtml(iso)}">${escapeHtml(text)}</time>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}
