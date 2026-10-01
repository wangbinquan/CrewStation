import type { ProjectDeletionContext } from '@crewstation/contracts';
import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { NativeDdlConnection, OriginalPostgresRole, PostgresRoleRemoval, RoleRemoval } from '../../api/databaseRemoval';
import { postgresServerSource } from './databaseReclamation';
import { withNativePostgresNames } from './nativeNames';

type Role = { name: string; oid: string };
const identity = (role: Omit<OriginalPostgresRole, 'identity'>) => jsonHash({ name: role.name, oid: role.oid, source: role.source });
function valid(role: Role) {
  if (!/^cs_[a-z0-9_]{1,60}$/.test(role.name) || !/^[1-9][0-9]*$/.test(role.oid) || Number(role.oid) > 4294967295) throw precondition('原角色名字或 OID 不合法');
}
async function catalog(connection: NativeDdlConnection, role: Role) {
  return connection.query<Role[]>('SELECT rolname AS name,oid::text AS oid FROM pg_roles WHERE rolname=$1 OR oid=$2::oid ORDER BY oid', [role.name, role.oid]);
}
function matched(rows: readonly Role[], original: Role) {
  if (!rows.length) return false;
  if (rows.length !== 1 || rows[0]?.name !== original.name || rows[0].oid !== original.oid) throw precondition('原角色名字或 OID 已替换，不能接管新角色');
  return true;
}
function permit(raw: ProjectDeletionContext, original: OriginalPostgresRole, peers: readonly OriginalPostgresRole[]) {
  const context = ProjectDeletionContextSchema.parse(raw), selected = context.confirmed.resources.filter((r) => r.kind === 'postgres-role');
  valid(original);
  if (original.identity !== identity(original)) throw precondition('原角色来源摘要不匹配');
  if (context.phase !== 'purge' || context.confirmed.participant !== 'data-control' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length ||
    !peers.some((peer) => jsonHash(peer) === jsonHash(original)) || new Set(peers.map((p) => p.oid)).size !== peers.length || selected.length !== peers.length) throw precondition('原角色不属于完整 data-control/purge 许可');
  for (const peer of peers) {
    valid(peer);
    const resource = selected.find((r) => r.id === peer.name);
    if (peer.identity !== identity(peer) || peer.source !== original.source || !resource || resource.count !== 1 || resource.scope !== 'physical' || resource.identity !== peer.identity || resource.sourceIdentity !== peer.identity) throw precondition('原角色清单或来源不属于已确认范围');
  }
  return context;
}
async function remaining(connection: NativeDdlConnection, original: OriginalPostgresRole, peers: readonly OriginalPostgresRole[]) {
  const [consumers] = await connection.query<{ present: boolean }[]>('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usesysid=$1::oid) OR EXISTS(SELECT 1 FROM pg_prepared_xacts WHERE owner=$2) AS present', [original.oid, original.name]);
  if (!consumers || typeof consumers.present !== 'boolean') throw precondition('原角色消费者观测不完整');
  if (consumers.present) return 'native-consumers' as const;
  // Normal DROP checks all databases. Never run global DROP OWNED or transfer foreign objects.
  const dependencies = await connection.query("SELECT 1 FROM pg_shdepend d WHERE refclassid='pg_authid'::regclass AND refobjid=$1::oid AND NOT(classid='pg_auth_members'::regclass AND EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.oid=d.objid AND (m.roleid=$1::oid OR m.member=$1::oid))) LIMIT 1", [original.oid]);
  const members = await connection.query<{ roleid: string; member: string; parent: string }[]>('SELECT m.roleid::text,m.member::text,p.rolname AS parent FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid WHERE m.roleid=$1::oid OR m.member=$1::oid ORDER BY m.roleid,m.member', [original.oid]);
  const known = new Set(peers.map((p) => p.oid));
  if (dependencies.length || members.some((m) => m.roleid === original.oid ? !known.has(m.member) : !known.has(m.roleid) && m.parent !== 'pg_read_all_data')) return 'native-dependencies' as const;
  return undefined;
}

/** Original-role transaction with normal DROP; active sessions and foreign dependencies are preserved. */
export function postgresRoleRemoval(adminUrl: string, assertGrant: (context: ProjectDeletionContext) => Promise<void>): RoleRemoval {
  const url = new URL(adminUrl), endpoint = JSON.stringify([url.protocol, url.hostname, url.port || '5432']);
  const source = (connection: NativeDdlConnection) => postgresServerSource((text) => connection.query<{ system_identifier: string; pg_control_version: number; catalog_version_no: number; directory: string }[]>(text), endpoint);
  return {
    capture: async (target) => {
      valid(target);
      return withNativePostgresNames(adminUrl, [target.name], async (connection) => {
        const before = await source(connection);
        if (!matched(await catalog(connection, target), target)) throw precondition('初次原角色 absent 不是清理证明');
        if (before !== await source(connection)) throw precondition('原角色服务器在观测期间变化');
        const original = { ...target, source: before }; return { ...original, identity: identity(original) };
      });
    },
    remove: async (raw, original, peers): Promise<PostgresRoleRemoval> => {
      const context = permit(raw, original, peers); await assertGrant(context);
      return withNativePostgresNames(adminUrl, peers.map((p) => p.name), async (connection) => {
        await assertGrant(context); await connection.query('BEGIN');
        try {
          await connection.query('LOCK TABLE pg_catalog.pg_authid,pg_catalog.pg_auth_members,pg_catalog.pg_shdepend IN SHARE ROW EXCLUSIVE MODE');
          await assertGrant(context); await connection.assertHeld();
          if (await source(connection) !== original.source) throw precondition('原角色服务器来源变化');
          for (const peer of peers) matched(await catalog(connection, peer), peer);
          const exists = matched(await catalog(connection, original), original), reason = await remaining(connection, original, peers);
          if (reason) { await connection.query('ROLLBACK'); return { kind: 'waiting', reason }; }
          if (exists) await connection.query('DROP ROLE "' + original.name + '"');
          if (matched(await catalog(connection, original), original) || await remaining(connection, original, peers)) throw precondition('原角色删除后仍有消费者或依赖');
          await assertGrant(context); await connection.query('COMMIT');
          if (await source(connection) !== original.source || matched(await catalog(connection, original), original) || await remaining(connection, original, peers)) throw precondition('原角色提交后来源未归零');
          await assertGrant(context);
          return { kind: 'gone', identity: original.identity, digest: jsonHash({ identity: original.identity, source: original.source, consumers: 0, dependencies: 0 }) };
        } catch (error) { try { await connection.query('ROLLBACK'); } catch { /* Native original connection may have stopped. */ } throw error; }
      });
    },
  };
}
