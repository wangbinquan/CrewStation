import { and, eq, inArray } from 'drizzle-orm';
import { BusinessMaterialObjectSchema, ResourceIdSchema, BUSINESS_NATIVE_MATERIAL_LIMITS } from '@crewstation/contracts';
import { notFound, precondition, validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { BusinessMaterialObjectScope as MaterialObjectScope } from '@crewstation/contracts';
import { MATERIAL_REFERENCE_PREFIX, type MaterialObjectRepository } from '../../../ports/objectContent';
import { objectReferences, objectSpaces, storedObjects } from '../objectTables';
import { assertObjectStorageUnfrozen, authorizeObjectWrite, objectStorageTransaction } from '../objectMetadata';
import { archiveObjects, archiveReferences } from '../archive/references';
import { assertStorageContractEnabled } from './contractState';

const owner = (materialId: string, revision: number) => ({ type: 'material-version' as const, id: `${MATERIAL_REFERENCE_PREFIX}${materialId}`, revision });
async function productionSpace(tx: Executor, input: Pick<MaterialObjectScope, 'projectId' | 'serviceId'>) {
  const space = (await tx.select().from(objectSpaces).where(and(eq(objectSpaces.serviceId, input.serviceId), eq(objectSpaces.env, 'production'))))[0]?.body;
  return space?.projectId === input.projectId ? space : undefined;
}
async function selected(tx: Executor, input: MaterialObjectScope) {
  ResourceIdSchema.parse(input.materialId);
  if (!input.objects.length || input.objects.length > BUSINESS_NATIVE_MATERIAL_LIMITS.files || new Set(input.objects.map((o) => o.objectId)).size !== input.objects.length || input.objects.reduce((sum, o) => sum + o.size, 0) > BUSINESS_NATIVE_MATERIAL_LIMITS.bytes) throw validation('对象材料预算或身份无效');
  for (const object of input.objects) BusinessMaterialObjectSchema.parse(object);
  await assertStorageContractEnabled(tx);
  const space = await productionSpace(tx, input);
  if (!space) throw notFound('材料对象空间');
  const objects = await archiveObjects(tx, space.id, input.objects.map((o) => o.objectId));
  const expected = new Map(input.objects.map((o) => [o.objectId, o]));
  for (const object of objects) if (object.sha256 !== expected.get(object.id)?.sha256 || object.size !== expected.get(object.id)?.size || object.size > space.maxObjectBytes) throw precondition('材料对象摘要、大小或套餐不一致', { code: 'material_object_mismatch' });
  return space;
}
export function materialObjectRepository(db: Database): MaterialObjectRepository {
  return {
    pin: (input, authority) => objectStorageTransaction(db, async (tx, now) => {
      const space = await selected(tx, input);
      await authorizeObjectWrite(tx, space, authority.source, authority.fence, now);
      await archiveReferences(tx, space.id, input.objects.map((o) => o.objectId), owner(input.materialId, input.revision ?? 1), 'active', now);
    }),
    // Any active pin revision of this material protects the immutable objects (a revived material uses a newer revision).
    check: (input) => db.transaction(async (tx) => {
      await selected(tx, input);
      const rows = await tx.select().from(objectReferences).where(and(inArray(objectReferences.objectId, input.objects.map((o) => o.objectId)), eq(objectReferences.ownerType, 'material-version'), eq(objectReferences.ownerId, `${MATERIAL_REFERENCE_PREFIX}${input.materialId}`)));
      const active = new Set(rows.filter((row) => row.body.state === 'active').map((row) => row.objectId));
      if (input.objects.every((object) => active.has(object.objectId))) return;
      if (rows.length && !active.size) throw precondition('材料对象固定引用已按保留期释放，请用原 requestKey 重新受理材料', { code: 'material_objects_released' });
      throw precondition('材料对象引用尚未固定', { code: 'material_objects_unpinned' });
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' }),
    // Idempotent per revision. Released tombstones also block a late pin of the same revision.
    release: (input) => objectStorageTransaction(db, async (tx, now) => {
      ResourceIdSchema.parse(input.materialId);
      const space = await productionSpace(tx, input), ids = [...new Set(input.objects.map((o) => o.objectId))];
      if (!space || !ids.length) return;
      await assertObjectStorageUnfrozen(tx, space.backendId);
      const present = (await tx.select({ id: storedObjects.id }).from(storedObjects).where(and(inArray(storedObjects.id, ids), eq(storedObjects.spaceId, space.id)))).map((row) => row.id);
      await archiveReferences(tx, space.id, present, owner(input.materialId, input.revision), 'released', now);
    }),
  };
}
