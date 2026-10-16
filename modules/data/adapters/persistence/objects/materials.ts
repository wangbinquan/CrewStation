import { and, eq, inArray } from 'drizzle-orm';
import { BusinessMaterialObjectSchema, ResourceIdSchema, BUSINESS_NATIVE_MATERIAL_LIMITS } from '@crewstation/contracts';
import { notFound, precondition, validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { BusinessMaterialObjectScope as MaterialObjectScope } from '@crewstation/contracts';
import { MATERIAL_REFERENCE_PREFIX, type MaterialObjectRepository } from '../../../ports/objects/materials';
import { objectReferences, objectSpaces } from '../objectTables';
import { authorizeObjectWrite, objectStorageTransaction } from '../objectMetadata';
import { archiveObjects, archiveReferences } from '../archive/references';
import { assertStorageContractEnabled } from './contractState';

async function selected(tx: Executor, input: MaterialObjectScope) {
  ResourceIdSchema.parse(input.materialId);
  if (!input.objects.length || input.objects.length > BUSINESS_NATIVE_MATERIAL_LIMITS.files || new Set(input.objects.map((o) => o.objectId)).size !== input.objects.length || input.objects.reduce((sum, o) => sum + o.size, 0) > BUSINESS_NATIVE_MATERIAL_LIMITS.bytes) throw validation('对象材料预算或身份无效');
  for (const object of input.objects) BusinessMaterialObjectSchema.parse(object);
  await assertStorageContractEnabled(tx);
  const space = (await tx.select().from(objectSpaces).where(and(eq(objectSpaces.serviceId, input.serviceId), eq(objectSpaces.env, 'production'))))[0]?.body;
  if (!space || space.projectId !== input.projectId) throw notFound('材料对象空间');
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
      await archiveReferences(tx, space.id, input.objects.map((o) => o.objectId), { type: 'material-version', id: `${MATERIAL_REFERENCE_PREFIX}${input.materialId}`, revision: 1 }, 'active', now);
    }),
    check: (input) => db.transaction(async (tx) => {
      await selected(tx, input);
      const rows = await tx.select().from(objectReferences).where(and(inArray(objectReferences.objectId, input.objects.map((o) => o.objectId)), eq(objectReferences.ownerType, 'material-version'), eq(objectReferences.ownerId, `${MATERIAL_REFERENCE_PREFIX}${input.materialId}`), eq(objectReferences.revision, 1)));
      if (rows.length !== input.objects.length || rows.some((row) => row.body.state !== 'active')) throw precondition('材料对象引用尚未固定', { code: 'material_objects_unpinned' });
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' }),
  };
}
