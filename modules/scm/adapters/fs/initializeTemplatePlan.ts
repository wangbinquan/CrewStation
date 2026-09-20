import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ManifestSchema, ResourceIdSchema, describeManifestFailure } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';

/** 只作用于尚未提交的模板副本；不修改模板源或已经存在的远端分支。 */
export async function initializeTemplatePlan(workdir: string, plan: string): Promise<void> {
  if (!ResourceIdSchema.safeParse(plan).success) throw validation('初始套餐 ID 不合法', { field: 'plan' });
  const path = join(workdir, 'crewstation.yaml');
  let document: unknown;
  try {
    document = Bun.YAML.parse(await readFile(path, 'utf8'));
  } catch {
    throw validation('选定模板的 crewstation.yaml 无法读取或解析', { field: 'template' });
  }
  const parsed = ManifestSchema.safeParse(document);
  if (!parsed.success) throw validation(`选定模板的 Manifest 不合法：${describeManifestFailure(parsed.error)}`, { field: 'template' });
  // 校验后仍写原始文档，避免 Schema 投影剥掉与此次套餐选择无关的扩展字段。
  const source = document as { spec: { service: Record<string, unknown> } };
  if (source.spec.service.servicePlanId === plan) return;
  source.spec.service.servicePlanId = plan;
  await writeFile(path, Bun.YAML.stringify(source));
}
