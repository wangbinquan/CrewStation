import type { ConfigEnv, ConfigItemDto } from '@crewstation/contracts';
import { shortTime, yesNo } from '../output/formatValue';
import { resolveProject } from '../platform/projectLookup';
import type { CommandContext } from '../runtime/commandContext';
import { enumFlag, requiredArg } from '../runtime/commandContext';

const ENVS: readonly ConfigEnv[] = ['production', 'development'];

/**
 * 配置与 Secret：development 与 production 两组取值。Secret 只写不读，
 * 服务端永远不回传取值；这里再按 isSecret 挡一次，免得将来服务端回归时从 CLI 漏出去。
 */
export async function listConfig(ctx: CommandContext): Promise<void> {
  const api = ctx.client();
  const env = enumFlag<ConfigEnv>(ctx, 'env', ENVS, 'production');
  const project = await resolveProject(api, requiredArg(ctx, 0, 'project'));
  const page = await api.config.list(project.id, env);
  if (ctx.json) return ctx.emit.json({ ...page, items: page.items.map(withoutSecretValue) });
  ctx.emit.table(
    ['名称', '机密', '取值', '版本', '更新人', '更新时间'],
    page.items.map((item) => [item.name, yesNo(item.isSecret), displayValue(item.isSecret, item.value), String(item.version), item.updatedBy, shortTime(item.updatedAt)]),
  );
  ctx.emit.note(`取值组：${env}；Secret 的取值不可读，只能覆盖写入`);
}

function displayValue(isSecret: boolean, value: string | undefined): string {
  if (isSecret) return '<secret>';
  return value === undefined || value.length === 0 ? '-' : value;
}

/**
 * --json 要的是原样 DTO；按契约 Secret 本来就不带 value，这里只是把“服务端万一回传”的路堵死。
 * 契约成立时输出与服务端逐字节相同，脚本拿到的仍是原始形状。
 */
function withoutSecretValue(item: ConfigItemDto): ConfigItemDto {
  if (!item.isSecret || item.value === undefined) return item;
  const { value: _dropped, ...rest } = item;
  return rest;
}
