import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';
import { infrastructureOriginReferences } from '../domain/infrastructureOrigins';
import type { InfrastructureOriginDocument, InfrastructureOriginReference } from '../domain/infrastructureOrigins';
import type { InfrastructureOriginSources } from '../ports/infrastructureOrigins';

const origin = z.object({ complete:z.literal(true),id:ResourceIdSchema,scope:z.enum(['project','platform']),
  projectIds:z.array(ProjectIdSchema),revision:z.string().regex(/^[a-f0-9]{64}$/) }).strict().superRefine((value,context) => {
  if (new Set(value.projectIds).size !== value.projectIds.length || (value.scope === 'platform') !== (value.projectIds.length === 0))
    context.addIssue({code:'custom',message:'原基础设施归属不完整或平台／项目范围混合'});
});

/** Source witnesses identify content ownership; they do not establish physical stopping or a deletion phase receipt. */
export async function resolveInfrastructureOwnership(document: InfrastructureOriginDocument, sources: InfrastructureOriginSources) {
  const references = infrastructureOriginReferences(document);
  const resolve = async (reference: InfrastructureOriginReference, representation: 'current'|'legacy') => {
    const raw = await sources.resolve(document,reference,representation);
    if (!raw) throw precondition('基础设施原对象或历史归属不可读取');
    const value = origin.parse(raw);
    if (representation === 'current' && value.id !== reference.key) throw precondition('基础设施当前 ID 与原对象不符');
    return {kind:reference.kind,...value,projectIds:[...value.projectIds].sort()};
  };
  const current = await Promise.all(references.current.map((reference) => resolve(reference,'current')));
  const legacy = await Promise.all(references.legacy.map((reference) => resolve(reference,'legacy')));
  const first = current[0];
  if (!first) throw precondition('基础设施原内容缺少归属来源');
  const scope = {scope:first.scope,projectIds:first.projectIds};
  if (current.some((value) => jsonHash({scope:value.scope,projectIds:value.projectIds}) !== jsonHash(scope))) throw precondition('基础设施各原对象的项目归属冲突');
  if (legacy.length && jsonHash(legacy) !== jsonHash(current)) throw precondition('基础设施旧键没有对应同一原对象，或来源已变化');
  return {...scope,origins:current.map(({kind,id,revision}) => ({kind,id,revision})),digest:jsonHash({scope,origins:current})};
}
