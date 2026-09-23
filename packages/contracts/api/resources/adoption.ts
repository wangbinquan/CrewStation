import { z } from 'zod';
import { ResourceKindSchema } from './resourceRecord';

/**
 * RFC-025 收编空跑报告（设计 §6.5，第一期只报告不改动）：集群里每个受管对象归谁、将来怎么处理。
 * owned：已由台账记录认领；adoptable：能按旧标签找到还在的所属对象，收编时生成记录与别名；
 * orphan：所属对象已不在（或已结束），收编时按孤儿规则回收（PVC 只进待回收）；retained：失败保留期内；
 * platform：系统命名空间里的平台组件（安装器管理，不在收编与回收范围）；unclassified：认不出归属。
 */
export const AdoptionVerdictSchema = z.enum(['owned', 'adoptable', 'orphan', 'retained', 'platform', 'unclassified']);

export const AdoptionItemSchema = z.object({
  kind: z.string().min(1).max(64),
  namespace: z.string().max(253).optional(),
  name: z.string().min(1).max(253),
  uid: z.string().max(64).optional(),
  verdict: AdoptionVerdictSchema,
  candidateKind: ResourceKindSchema.optional(),
  owner: z.string().max(64).optional(),
  ownerRef: z.string().max(200).optional(),
  resourceId: z.string().max(64).optional(),
  reason: z.string().max(500),
}).strict();

export const AdoptionReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  dryRun: z.literal(true),
  counts: z.record(AdoptionVerdictSchema, z.number().int().nonnegative()),
  items: z.array(AdoptionItemSchema),
}).strict();

export type AdoptionVerdict = z.infer<typeof AdoptionVerdictSchema>;
export type AdoptionItem = z.infer<typeof AdoptionItemSchema>;
export type AdoptionReport = z.infer<typeof AdoptionReportSchema>;
