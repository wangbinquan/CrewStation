import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

/** Only this module reads delivery lineage. Minimum original links survive content removal; no slug or current name is consulted. */
export async function deliveryInfrastructureOrigin(db: Database, rawId: string) {
  const id = ResourceIdSchema.parse(rawId);
  const rows = await db.execute<{ recipient: string; projects: unknown; active: unknown }>(sql`
    SELECT root.project_id AS recipient,
      (SELECT jsonb_agg(project_id ORDER BY project_id) FROM events.deletion_links WHERE kind='delivery' AND entity_key=${id}) AS projects,
      (SELECT jsonb_build_object('recipient',d.project_id,
        'service',(SELECT project_id FROM events.deletion_entities WHERE kind='service' AND entity_key=d.service_id),
        'subscription',(SELECT project_id FROM events.deletion_entities WHERE kind='subscription' AND entity_key=d.subscription_id),
        'event',(SELECT project_id FROM events.deletion_entities WHERE kind='event' AND entity_key=d.event_id),
        'type',(SELECT project_id FROM events.deletion_entities WHERE kind='event-type' AND entity_key=d.event_type_id))
       FROM events.deliveries d WHERE d.id=${id}) AS active
    FROM events.deletion_entities root WHERE root.kind='delivery' AND root.entity_key=${id}`);
  if (!rows.length) return undefined;
  const row = rows[0]!,recipient = ProjectIdSchema.parse(row.recipient);
  if (!Array.isArray(row.projects) || !row.projects.length) throw precondition('投递原项目关系不完整');
  const projectIds = row.projects.map((value) => ProjectIdSchema.parse(value)).sort();
  if (new Set(projectIds).size !== projectIds.length || !projectIds.includes(recipient)) throw precondition('投递原项目关系冲突');
  if (row.active !== null) {
    const active = row.active as Record<string,unknown>;
    if (!active || typeof active !== 'object' || Array.isArray(active) || Object.keys(active).sort().join(',') !== 'event,recipient,service,subscription,type') throw precondition('投递当前原关系不可读取');
    for (const value of Object.values(active)) if (!projectIds.includes(ProjectIdSchema.parse(value))) throw precondition('投递当前与历史原项目关系不符');
    if (active.recipient !== recipient || active.service !== recipient || active.subscription !== recipient || active.event !== active.type) throw precondition('投递原收件或生产方归属冲突');
  }
  return {complete:true as const,id,scope:'project' as const,projectIds,revision:jsonHash({id,recipient,projectIds})};
}
