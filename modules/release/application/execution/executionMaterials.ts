import { BusinessReleaseMaterialsSchema, BusinessRelativePathSchema } from '@crewstation/contracts';
import type { BusinessReleaseMaterials, Manifest } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { Release } from '../../domain/release';
import type { RepoReader } from '../../ports/sourceControl';

export async function loadExecutionMaterials(repo: RepoReader, release: Release, manifest: Manifest): Promise<BusinessReleaseMaterials> {
  if (release.pipeline.executionMaterials) return release.pipeline.executionMaterials;
  const tasks = manifest.kind === 'DigitalWorker' ? manifest.spec.tasks : undefined;
  const paths = [...new Set([...(tasks?.agentProfiles.flatMap((profile) => profile.systemPromptFile ? [profile.systemPromptFile] : []) ?? []), ...(tasks?.outputContracts.flatMap((contract) => contract.schema ? [contract.schema] : []) ?? [])])];
  const files: BusinessReleaseMaterials = {};
  for (const path of paths) {
    const parsed = BusinessRelativePathSchema.safeParse(path);
    if (!parsed.success) throw validation(`执行文件必须是安全相对路径：${path}`);
    const content = await repo.readFile(release.serviceId, release.commitSha, path);
    if (content === undefined) throw validation(`固定源码提交缺少执行文件：${path}`);
    files[path] = content;
    const bounded = BusinessReleaseMaterialsSchema.safeParse(files);
    if (!bounded.success) throw validation(bounded.error.issues[0]!.message);
  }
  for (const contract of tasks?.outputContracts ?? []) {
    for (const path of contract.required) if (!BusinessRelativePathSchema.safeParse(path).success) throw validation(`产物路径不安全：${path}`);
    if (contract.schema) {
      try { const schema = JSON.parse(files[contract.schema]!); if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('schema must be an object'); }
      catch { throw validation(`输出契约 Schema 不是有效 JSON 对象：${contract.schema}`); }
    }
  }
  return files;
}
