import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { imageAllocationRevision } from '../api/allocationRevision';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
const available = await testDatabaseAvailable(); let f: RuntimeImageFixture;
beforeAll(async () => { if (available) f = await runtimeImageFixture(); }); afterAll(async () => { await f?.tdb.drop(); });
describe.skipIf(!available)('resource center runtime image allocations', () => {
  test('no build is started, inherited grants are additive and receipts replay after catalog revision changes', async () => {
    const image = await f.image(), command = { operationId: newResourceId(), target: { resourceType: 'runtime-image' as const, resourceId: image.id, action: 'grant' as const }, expectedRevision: imageAllocationRevision(0, image), values: {} };
    await expect(f.api.applyResourceChange({ ...f.developer, isAdmin: true }, f.otherProject, command)).rejects.toMatchObject({ kind: 'forbidden' });
    const receipt = await f.api.applyResourceChange(f.admin, f.otherProject, command);
    expect(receipt.applied).toBe(true); expect(f.prepares()).toBe(0);
    expect((await f.api.getProjectImagePolicy(f.admin, f.otherProject)).policy).toMatchObject({ mode: 'inherit', additionalImageIds: [image.id] });
    expect(await f.api.getImage(f.developer, f.otherProject, image.id)).toMatchObject({ id: image.id });
    expect(await f.api.applyResourceChange(f.admin, f.otherProject, command)).toEqual(receipt);
    await expect(f.api.applyResourceChange(f.admin, f.otherProject, { ...command, values: { unwanted: 1 } })).rejects.toMatchObject({ kind: 'validation' });
    await expect(f.api.applyResourceChange(f.admin, f.otherProject, { ...command, operationId: newResourceId() })).rejects.toMatchObject({ kind: 'conflict' });
    const current = await f.api.getImage(f.admin, f.project, image.id);
    await f.api.applyResourceChange(f.admin, f.otherProject, { ...command, operationId: newResourceId(), target: { ...command.target, action: 'revoke' }, expectedRevision: imageAllocationRevision(1, current) });
    await expect(f.api.getImage(f.developer, f.otherProject, image.id)).rejects.toMatchObject({ kind: 'not_found' });
    expect((await f.api.getProjectImagePolicy(f.admin, f.otherProject)).policy).toMatchObject({ mode: 'inherit', additionalImageIds: [], excludedImageIds: [image.id] });
    expect(await f.api.resourceChangeReceipt(f.project, command.operationId)).toBeUndefined();
  });
  test('one current policy revision admits one concurrent resource command', async () => {
    const image = await f.image(), project = newResourceId(), input = { target: { resourceType: 'runtime-image' as const, resourceId: image.id, action: 'grant' as const }, expectedRevision: imageAllocationRevision(0, image), values: {} };
    const outcomes = await Promise.allSettled([1, 2].map(() => f.api.applyResourceChange(f.admin, project, { ...input, operationId: newResourceId() })));
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1); expect((await f.api.getProjectImagePolicy(f.admin, project)).revision).toBe(1);
  });
});
