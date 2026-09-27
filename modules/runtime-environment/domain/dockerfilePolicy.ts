import type { RuntimeImageArchitecture, RuntimeImageUsage } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import { DockerfileParser } from 'dockerfile-ast';

interface Stage { readonly name?: string; readonly base: string; readonly parent?: number; readonly platform?: string }
export interface DockerfilePolicyInput {
  readonly usage: RuntimeImageUsage;
  readonly architecture: RuntimeImageArchitecture;
  readonly target?: string;
}

/** AST 只证明最终阶段的声明继承关系；产物的 diff_ids 与 Runner 实测仍是独立必要检查。 */
export function inspectRuntimeDockerfile(content: string, input: DockerfilePolicyInput): { targetIndex: number; stages: readonly Stage[] } {
  if (content.includes('\0') || content.length > 1024 * 1024) throw validation('Dockerfile 为空字符或超过 1 MiB');
  const ast = DockerfileParser.parse(content);
  // 构建使用安装时固定的内置 frontend；禁止用户把 #syntax 换成能跳过策略的程序。
  if (ast.getDirectives().some((directive) => directive.getName().toLowerCase() === 'syntax')) throw validation('运行镜像使用平台固定 frontend，请移除 Dockerfile 的 #syntax 指令');
  const stages: Stage[] = [], names = new Map<string, number>();
  for (const from of ast.getFROMs()) {
    const base = from.getImage(), name = from.getBuildStage()?.toLowerCase();
    if (!base) throw validation('FROM 必须指定基础镜像');
    if (name && names.has(name)) throw validation(`Dockerfile 阶段 ${name} 重复`);
    const parent = names.get(base.toLowerCase()), platform = from.getPlatformFlag()?.getValue();
    stages.push({ base, ...(name ? { name } : {}), ...(parent === undefined ? {} : { parent }), ...(platform ? { platform } : {}) });
    if (name) names.set(name, stages.length - 1);
  }
  if (!stages.length) throw validation('Dockerfile 必须包含 FROM');
  const targetIndex = input.target === undefined ? stages.length - 1 : names.get(input.target.toLowerCase());
  if (targetIndex === undefined) throw validation(`Dockerfile 不存在 target ${input.target}`);
  if (input.usage === 'service') return { targetIndex, stages };
  if (!ast.getInitialARGs().some((arg) => arg.getProperty()?.getName() === 'CS_BASE_IMAGE')) throw validation('任务和 Agent Dockerfile 必须在 FROM 前声明 ARG CS_BASE_IMAGE');
  let root = stages[targetIndex]!;
  while (true) {
    if (root.platform && ![input.architecture, '$TARGETPLATFORM', '${TARGETPLATFORM}'].includes(root.platform)) throw validation('最终镜像阶段的架构必须等于所选目标架构');
    if (root.parent === undefined) break;
    root = stages[root.parent]!;
  }
  if (!['$CS_BASE_IMAGE', '${CS_BASE_IMAGE}'].includes(root.base)) throw validation('任务和 Agent 最终阶段必须继承平台指定的 CS_BASE_IMAGE；COPY 平台文件不能代替继承');
  return { targetIndex, stages };
}
