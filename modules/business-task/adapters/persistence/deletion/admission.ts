import { sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';

/** Background candidates exclude permanent closures before taking leases or parsing private bodies. */
export function businessAdmissionOpen(service: SQLWrapper): SQL {
  return sql`NOT EXISTS(SELECT 1 FROM business_task.content_origins original
    INNER JOIN business_task.project_admissions closed ON closed.project_id=original.project_id
    WHERE original.kind='service' AND original.key=${service})`;
}
