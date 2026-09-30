import type { ProjectDeletionTarget } from '@crewstation/contracts';
import { sql } from 'drizzle-orm';

export const CONTENT = ['proxies', 'operations', 'grants', 'requests', 'allocation_receipts'] as const;
export function services(target: ProjectDeletionTarget) {
  return sql`SELECT entity_id FROM api_catalog.deletion_entities WHERE kind='service' AND project_id=${target.id}
    UNION SELECT service_id FROM api_catalog.proxies WHERE project_id=${target.id}
    UNION SELECT service_id FROM api_catalog.requests WHERE project_id=${target.id}
    UNION SELECT ${target.serviceId ?? null}::text WHERE ${target.serviceId ?? null}::text IS NOT NULL`;
}
export function operations(target: ProjectDeletionTarget) {
  return sql`SELECT id FROM api_catalog.operations WHERE proxy_id IN (SELECT id FROM api_catalog.proxies WHERE project_id=${target.id})
    UNION SELECT entity_id FROM api_catalog.deletion_entities WHERE kind='operation' AND project_id=${target.id}`;
}
export function owned(table: typeof CONTENT[number], target: ProjectDeletionTarget) {
  if (table === 'proxies' || table === 'requests') return sql`project_id=${target.id}`;
  if (table === 'operations') return sql`id IN (${operations(target)})`;
  return sql`service_id IN (${services(target)})`;
}
