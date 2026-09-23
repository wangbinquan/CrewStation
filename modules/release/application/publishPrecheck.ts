import type { Manifest } from '@crewstation/contracts';
import { ManifestSchema, describeManifestFailure } from '@crewstation/contracts';
import { migrationReason } from '../domain/migrationPolicy';
import type { PrecheckReason } from '../domain/precheck';
import { precheckReason } from '../domain/precheck';
import type { PhysicalSlot } from '../domain/slots';
import type { DeployCheckDeps, DeployTarget } from './deployPrecheck';
import { deployChecks } from './deployPrecheck';
import type { ReleaseUseCaseDeps } from './dependencies';
import type { ResolvedService } from './pipelineContext';

const MANIFEST_HINT = '改好仓库里的 crewstation.yaml 并提交后再发布';

/** 要发布的那次提交里的 crewstation.yaml：不在、不是合法 YAML、不符合当前写法，各给原因。 */
async function manifestAt(deps: Pick<ReleaseUseCaseDeps, 'repo'>, serviceId: DeployTarget['serviceId'], ref: string, label: string): Promise<Manifest | { readonly reason: PrecheckReason }> {
  const text = await deps.repo.readFile(serviceId, ref, 'crewstation.yaml');
  if (!text) return { reason: precheckReason('manifest-missing', `${label} 上没有 crewstation.yaml`, '在仓库根目录提交 crewstation.yaml 后再发布') };
  let document: unknown;
  try { document = Bun.YAML.parse(text); } catch (error) { return { reason: precheckReason('manifest-invalid', `${label} 上的 crewstation.yaml 不是合法的 YAML：${error instanceof Error ? error.message : String(error)}`, MANIFEST_HINT) }; }
  const parsed = ManifestSchema.safeParse(document);
  // 与开发会话、流水线同一套说法：说清错在哪，也说清改成什么。
  return parsed.success ? parsed.data : { reason: precheckReason('manifest-invalid', `${label} 上的 crewstation.yaml 无效：${describeManifestFailure(parsed.error)}`, MANIFEST_HINT) };
}

/**
 * 发布受理之前的统一预检（RFC-025 设计 §5、B4）：按要打标签的那次提交读 crewstation.yaml、按当前写法校验，再做部署到待命槽之前的检查
 * （套餐与副本、档位、生产配置）与迁移策略（破坏性迁移只在维护窗口里）。任何一项不过都不打标签、不登记发布；构建之后流水线仍会再查一次。
 */
export async function publishReason(deps: DeployCheckDeps & Pick<ReleaseUseCaseDeps, 'repo' | 'maintenance'>, input: { readonly target: DeployTarget; readonly svc: ResolvedService; readonly ref: string; readonly label: string; readonly physical: PhysicalSlot }): Promise<PrecheckReason | undefined> {
  const manifest = await manifestAt(deps, input.target.serviceId, input.ref, input.label);
  if ('reason' in manifest) return manifest.reason;
  const migration = manifest.spec.release.migration;
  const blocked = migrationReason(migration, migration.destructive && await deps.maintenance.open(input.target.serviceId));
  if (blocked) return blocked;
  const checked = await deployChecks(deps, input.target, input.svc, manifest, input.physical);
  return 'reason' in checked ? checked.reason : undefined;
}
