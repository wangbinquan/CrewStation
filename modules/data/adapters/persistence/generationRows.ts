import type { DataEnv, ServiceId } from '@crewstation/contracts';
import { DatabasePhysicalIdentitySchema, ProjectIdSchema, ServiceIdSchema } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DatabaseGeneration, DatabaseEnvironmentBinding } from '../../domain/databaseGeneration';
export type GenerationRow = { id: string; resource_id: string; project_id: string; service_id: string; env: DataEnv; object_name: string; credential_resource_id: string; secret_box: string | null; migration_operation_id: string | null; origin: DatabaseGeneration['origin']; restore_operation_id: string | null; state: DatabaseGeneration['state']; identity: DatabaseGeneration['identity']; empty_proof: DatabaseGeneration['emptyProof']; created_at: Date | string; updated_at: Date | string };
export type BindingRow = { migration_operation_id: string | null; last_migration_operation_id: string | null; migration_opened: boolean; migration_reverted: boolean; resource_id: string; project_id: string; service_id: string; env: DataEnv; generation_id: string; revision: number; restore_operation_id: string | null; last_restore_operation_id: string | null; previous_generation_id: string | null };
export const generation = (row: GenerationRow): DatabaseGeneration => ({ id: row.id, resourceId: row.resource_id, projectId: ProjectIdSchema.parse(row.project_id), serviceId: ServiceIdSchema.parse(row.service_id), env: row.env, objectName: row.object_name, credentialResourceId: row.credential_resource_id, secretBox: row.secret_box, origin: row.origin, migrationOperationId: row.migration_operation_id, restoreOperationId: row.restore_operation_id, state: row.state, identity: row.identity ? DatabasePhysicalIdentitySchema.parse(row.identity) : null, emptyProof: row.empty_proof, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) });
export const binding = (row: BindingRow): DatabaseEnvironmentBinding => ({ resourceId: row.resource_id, projectId: ProjectIdSchema.parse(row.project_id), serviceId: ServiceIdSchema.parse(row.service_id), env: row.env, generationId: row.generation_id, migrationOperationId: row.migration_operation_id, revision: row.revision, restoreOperationId: row.restore_operation_id, lastRestoreOperationId: row.last_restore_operation_id, previousGenerationId: row.previous_generation_id });
export async function current(db: Executor, serviceId: ServiceId, env: DataEnv, lock = false): Promise<BindingRow | undefined> {
  return (await db.execute<BindingRow>(sql`SELECT * FROM data.database_environment_bindings WHERE service_id=${serviceId} AND env=${env} ${lock ? sql`FOR UPDATE` : sql``}`))[0];
}
export async function get(db: Executor, id: string): Promise<DatabaseGeneration | undefined> {
  const row = (await db.execute<GenerationRow>(sql`SELECT * FROM data.database_generations WHERE id=${id}`))[0]; return row ? generation(row) : undefined;
}

