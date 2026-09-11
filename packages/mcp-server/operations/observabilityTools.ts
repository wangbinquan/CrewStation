import { LogSourceSchema, SlotNameSchema, TaskIdSchema } from '@crewstation/contracts';
import { z } from 'zod';
import type { McpToolDefinition } from '../protocol/definitions';
import { toolFactory } from '../protocol/definitions';
import type { OperationsContext } from './operationsContext';

const tool = toolFactory<OperationsContext>();

/** 预览与日志：只读，供 Agent 自查刚做的改动有没有跑起来。 */
export function observabilityTools(): Array<McpToolDefinition<OperationsContext>> {
  return [readPreviewStatus(), tailLogs()];
}

function readPreviewStatus(): McpToolDefinition<OperationsContext> {
  return tool({
    name: 'read_preview_status',
    title: '查看预览状态',
    description: [
      '一次看两件事：开发会话里预览进程的守护状态与预览地址，以及 preview／prod 两个部署槽当前是哪个 Release、副本是否就绪。',
      '改完代码先看这里，再决定要不要发布。',
    ].join(''),
    input: {},
    run: async (_args, ctx) => {
      const project = await ctx.project();
      const client = ctx.client();
      const session = await client.devSession.get(project.projectId);
      const slots = await client.services.listSlots(project.serviceId);
      return {
        devSession: { state: session.state, branch: session.branch, previewHost: session.previewHost, preview: session.preview },
        slots: slots.items,
      };
    },
  });
}

function tailLogs(): McpToolDefinition<OperationsContext> {
  return tool({
    name: 'tail_logs',
    title: '读取日志',
    description: [
      '按来源读取本项目的最近日志：slot（部署槽）、dev-session（开发会话容器）、business-task（业务任务容器）、',
      'build（构建 Job）、migration（迁移 Job）。source 为 slot 时可用 slot 指定 preview 或 prod。',
    ].join(''),
    input: {
      source: LogSourceSchema.describe('日志来源'),
      slot: SlotNameSchema.optional().describe('source 为 slot 时指定 preview 或 prod'),
      taskId: TaskIdSchema.optional().describe('source 为 dev-session 或 business-task 时限定某个任务'),
      since: z.iso.datetime().optional().describe('只看该 ISO 时间之后的日志'),
      limit: z.number().int().min(1).max(2000).optional().describe('最多返回多少条，缺省 500'),
    },
    run: async (args, ctx) => {
      const project = await ctx.project();
      const page = await ctx.client().observability.logs(project.projectId, {
        source: args.source,
        ...(args.slot === undefined ? {} : { slot: args.slot }),
        ...(args.taskId === undefined ? {} : { taskId: args.taskId }),
        ...(args.since === undefined ? {} : { since: args.since }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      });
      return page.items;
    },
  });
}
