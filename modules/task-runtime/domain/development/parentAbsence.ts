import { z } from 'zod';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DevelopmentParentMaterials } from './parentMaterials';
const AbsenceSchema = z.strictObject({ version: z.literal(1), epochHash: z.string().regex(/^[a-f0-9]{64}$/), pvcUid: z.uuid(), observedAt: z.iso.datetime(),
  objects: z.array(z.strictObject({ kind: z.enum(['Pod', 'Secret']), namespace: z.string().min(1), name: z.string().min(1), uid: z.uuid(), state: z.literal('absent') })) });
export function requireDevelopmentParentAbsence(raw: unknown, materials: DevelopmentParentMaterials) {
  const absence = AbsenceSchema.parse(raw);
  const expected = [{ kind: 'Pod', ...materials.pod }, ...materials.secrets.filter((s) => s.owned).map((s) => ({ kind: 'Secret', ...s }))]
    .map((o) => ({ kind: o.kind, namespace: materials.namespace, name: o.name, uid: o.uid, state: 'absent' })).sort((a, b) => (a.kind + a.name).localeCompare(b.kind + b.name));
  if (absence.epochHash !== materials.epochHash || absence.pvcUid !== materials.pvc.uid
    || jsonHash([...absence.objects].sort((a, b) => (a.kind + a.name).localeCompare(b.kind + b.name))) !== jsonHash(expected))
    throw precondition('原父实际消失见证不覆盖完整原 UID 集合');
  return absence;
}
