import type { ProjectDeletionTarget } from '@crewstation/contracts';
import { sql } from 'drizzle-orm';

export const CONTENT = ['producers','event_types','subscriptions','inbox','deliveries','deletion_work'] as const;
export function deliveryIds(target: ProjectDeletionTarget) {
  return sql`SELECT entity_key FROM events.deletion_links WHERE kind='delivery' AND project_id=${target.id}`;
}
export function typeIds(target: ProjectDeletionTarget) {
  return sql`SELECT entity_key FROM events.deletion_entities WHERE kind='event-type' AND project_id=${target.id}`;
}
export function owned(table: typeof CONTENT[number], target: ProjectDeletionTarget) {
  if (table === 'producers' || table === 'subscriptions') return sql`project_id=${target.id}`;
  if (table === 'deliveries') return sql`project_id=${target.id} OR id IN (${deliveryIds(target)})`;
  if (table === 'deletion_work') return sql`delivery_id IN (${deliveryIds(target)})`;
  return sql`id IN (SELECT entity_key FROM events.deletion_entities WHERE kind=${table === 'event_types' ? 'event-type' : 'event'} AND project_id=${target.id})`;
}
