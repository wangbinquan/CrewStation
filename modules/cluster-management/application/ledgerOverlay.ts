import type { Actor, ClusterLedger, ClusterResource } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { claimKey, withLedger } from '../domain/ledgerOverlay';
import type { ClusterDeps } from './dependencies';

/** 按这一页的对象向资源中心要所属记录的叠加；没接台账（测试、旧装配）时原样返回。 */
async function claimsFor(deps: Pick<ClusterDeps, 'ledger'>, actor: Actor, rows: readonly ClusterResource[]): Promise<Map<string, ClusterLedger>> {
  if (!deps.ledger || !rows.length) return new Map();
  const claims = await deps.ledger.claims(actor, rows.map((row) => ({ kind: row.kind, ...(row.namespace ? { namespace: row.namespace } : {}), name: row.name })));
  return new Map(claims.map((claim) => [claimKey(claim.child), claim.ledger]));
}

/**
 * 读清单、详情时的叠加（I29 裁定 (1)）：快照是底数，台账认领的行换上标准记录的阶段、原因与可做操作。台账暂时读不到时照快照给，
 * 不挡住清单——真正执行删除之前的检查（inspectionOverlay）会再核对一次。
 */
export async function overlayLedger(deps: Pick<ClusterDeps, 'ledger' | 'logger'>, actor: Actor, rows: ClusterResource[], readOnly = false): Promise<ClusterResource[]> {
  let claims;
  try { claims = await claimsFor(deps, actor, rows); } catch (error) {
    deps.logger?.warn('cluster ledger overlay failed', { error: String(error) });
    return rows;
  }
  return rows.map((row) => withLedger(row, claims.get(claimKey(row)), readOnly));
}

/** 运维检查（删除、重启……之前）按实时对象叠加：台账读不到就不给做，免得删掉一个马上被补回的对象（I29 裁定 (2)）。 */
export async function inspectionOverlay(deps: Pick<ClusterDeps, 'ledger'>, actor: Actor, row: ClusterResource): Promise<ClusterResource> {
  let claims;
  try { claims = await claimsFor(deps, actor, [row]); } catch (error) { throw precondition(`无法核对资源中心的记录：${String(error)}`); }
  return withLedger(row, claims.get(claimKey(row)));
}
