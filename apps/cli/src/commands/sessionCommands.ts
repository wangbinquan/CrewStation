import type { DevSessionDto } from '@crewstation/contracts';
import { dash, shortTime } from '../output/formatValue';
import { startupLines } from '../output/startupLines';
import { findDevSession, resolveProject } from '../platform/projectLookup';
import type { CommandContext } from '../runtime/commandContext';
import { boolFlag, requiredArg, requiredStringFlag } from '../runtime/commandContext';

/**
 * 开发会话：一个项目同时只有一个。容器长驻、带自己的 TaskRunner，
 * 里面可以并行跑多个流式 Agent；CLI 只负责开与释放，交互在工作台。
 */
export async function openSession(ctx: CommandContext): Promise<void> {
  const api = ctx.client();
  const project = await resolveProject(api, requiredArg(ctx, 0, 'project'));
  const session = await api.devSession.open(project.id, { branch: requiredStringFlag(ctx, 'branch') });
  if (ctx.json) return ctx.emit.json(session);
  ctx.emit.success(`开发会话已创建：${session.taskId}`);
  ctx.emit.fields(sessionFields(session));
  printStartup(ctx, session);
}

/** RFC-022：开始开发或重建的启动过程，与工作台看到的是同一份。 */
function printStartup(ctx: CommandContext, session: DevSessionDto): void {
  if (session.startup) for (const line of startupLines(session.startup)) ctx.emit.line(line);
}

export async function showSession(ctx: CommandContext): Promise<void> {
  const api = ctx.client();
  const project = await resolveProject(api, requiredArg(ctx, 0, 'project'));
  const session = await findDevSession(api, project.id);
  if (ctx.json) return ctx.emit.json(session ?? null);
  if (session === undefined) return ctx.emit.note(`项目 ${project.slug} 当前没有开发会话`);
  ctx.emit.fields(sessionFields(session));
  printStartup(ctx, session);
}

/** 释放会话不删除托管源码；容器里尚未推送的提交会被列出来，提醒先推送。 */
export async function releaseSession(ctx: CommandContext): Promise<void> {
  const api = ctx.client();
  const project = await resolveProject(api, requiredArg(ctx, 0, 'project'));
  const result = await api.devSession.release(project.id, { force: boolFlag(ctx, 'force') });
  if (ctx.json) return ctx.emit.json(result);
  ctx.emit.success(`开发会话已释放：${result.session.taskId}（${result.session.state}）`);
  if (result.unpushed === null) return ctx.emit.warn('释放前无法确认未推送提交；检查失败不代表代码已保存到远端');
  if (result.unpushed.length === 0) return ctx.emit.note('没有未推送的提交');
  ctx.emit.warn(`容器里有 ${result.unpushed.length} 个未推送的提交：`);
  for (const commit of result.unpushed) ctx.emit.line('  ' + commit);
}

function sessionFields(session: DevSessionDto): readonly (readonly [string, string])[] {
  return [
    ['任务 ID', session.taskId], ['状态', session.state], ['分支', session.branch],
    ['Pod', dash(session.podName)], ['预览地址', session.previewHost], ['预览状态', session.preview],
    ['创建人', session.createdBy], ['创建时间', shortTime(session.createdAt)],
    ['最后活动', shortTime(session.lastActivityAt)], ['说明', dash(session.message)],
  ];
}
