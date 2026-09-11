import { z } from 'zod';
import type { McpToolDefinition } from '../protocol/definitions';
import { toolFactory } from '../protocol/definitions';
import type { OperationsContext } from './operationsContext';

const tool = toolFactory<OperationsContext>();

const VersionSchema = z.union([
  z.string().regex(/^v\d+\.\d+\.\d+$/, '完整版本号形如 v1.2.3'),
  z.enum(['major', 'minor', 'patch']),
]);

/** 发布与分支：与工作台按钮、CLI 走同一条 cs-api 路由，不存在“Agent 专用的发布捷径”。 */
export function releaseTools(): Array<McpToolDefinition<OperationsContext>> {
  return [publishRelease(), listBranches()];
}

function publishRelease(): McpToolDefinition<OperationsContext> {
  return tool({
    name: 'publish_release',
    title: '发布到待命槽',
    description: [
      '把指定分支发布到待命（preview）槽：平台检查未提交更改 → 代为推送该分支 → 创建 v<大>.<小>.<修订> 标签 →',
      '按固定 SHA 干净构建 → 对生产库执行兼容迁移 → 部署到待命槽。切流到生产是项目负责人的独立动作，本工具不做。',
      '工作区有未提交更改时会被拒绝并列出文件；先提交再重试，平台不会替你 git add，也不改写提交历史。',
    ].join(''),
    input: {
      branch: z.string().min(1).describe('要发布的分支名，通常是当前开发会话所用分支'),
      version: VersionSchema.optional().describe('完整版本号如 v1.2.3，或递增级别 major／minor／patch；缺省为 patch'),
      message: z.string().max(500).optional().describe('发布说明，写清这次变更做了什么'),
    },
    run: async (args, ctx) => {
      const project = await ctx.project();
      return ctx.client().devSession.publish(project.projectId, {
        branch: args.branch,
        ...(args.version === undefined ? {} : { version: args.version }),
        ...(args.message === undefined ? {} : { message: args.message }),
      });
    },
  });
}

function listBranches(): McpToolDefinition<OperationsContext> {
  return tool({
    name: 'list_branches',
    title: '列出分支与落后提交数',
    description:
      '列出本服务仓库的分支：HEAD 提交、是否默认分支，以及相对 preview 槽与 prod 槽各落后多少提交。发布前用它确认选对了分支。',
    input: {},
    run: async (_args, ctx) => {
      const project = await ctx.project();
      const page = await ctx.client().devSession.listBranches(project.projectId);
      return page.items;
    },
  });
}
