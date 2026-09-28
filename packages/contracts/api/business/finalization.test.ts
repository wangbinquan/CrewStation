import { expect, test } from 'bun:test';
import { CreateBusinessTaskV3Schema } from './requests';
import { AdministrativeFinalizationSchema, ConfirmFinalizationLossSchema, FinalizeBusinessTaskSchema, ReviseBusinessArchiveSchema } from './finalization';
import { ArchivePlanPageSchema, SealedArchivePlanSchema } from '../object-storage/archivePlans';

const id = '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', digest = 'a'.repeat(64);
const create = { requestKey: 'create', taskContractVersion: 'aw/v1' };
const finalize = { requestKey: 'finalize', expectedGeneration: 1, outcome: 'succeeded', archive: { planId: id, planRevision: 1, digest } };

test('旧任务创建形状不变，归档策略必须显式搭配持久卷', () => {
  expect(CreateBusinessTaskV3Schema.parse(create)).not.toHaveProperty('completionPolicy');
  for (const volumeMode of ['follow-container', 'persistent']) expect(CreateBusinessTaskV3Schema.safeParse({ ...create, volumeMode }).success).toBe(true);
  expect(CreateBusinessTaskV3Schema.safeParse({ ...create, completionPolicy: 'archive-and-delete', volumeMode: 'persistent' }).success).toBe(true);
  for (const volumeMode of [undefined, 'follow-container']) expect(CreateBusinessTaskV3Schema.safeParse({ ...create, completionPolicy: 'archive-and-delete', volumeMode }).success).toBe(false);
  expect(CreateBusinessTaskV3Schema.safeParse({ ...create, completionPolicy: 'retain' }).success).toBe(false);
});

test('终结固定清单身份、业务结果和世代；空计划必须明确理由', () => {
  expect(FinalizeBusinessTaskSchema.safeParse(finalize).success).toBe(true);
  expect(FinalizeBusinessTaskSchema.safeParse({ ...finalize, archive: { noArtifactsReason: '只提交远端代码，无需保存本地产物' } }).success).toBe(true);
  for (const archive of [{}, { noArtifactsReason: '  ' }, { ...finalize.archive, noArtifactsReason: 'discard' }, { ...finalize.archive, digest: 'bad' }]) expect(FinalizeBusinessTaskSchema.safeParse({ ...finalize, archive }).success).toBe(false);
  expect(FinalizeBusinessTaskSchema.safeParse({ ...finalize, outcome: 'paused' }).success).toBe(false);
  expect(FinalizeBusinessTaskSchema.safeParse({ ...finalize, expectedGeneration: 0 }).success).toBe(false);
});

test('管理员代终结和损失清理需要明确确认词、理由及评估摘要', () => {
  const administrative = { ...finalize, reason: '原服务已下线', confirmation: 'finalize' };
  expect(AdministrativeFinalizationSchema.safeParse(administrative).success).toBe(true);
  expect(AdministrativeFinalizationSchema.safeParse({ ...administrative, confirmation: 'delete' }).success).toBe(false);
  const loss = { requestKey: 'loss', expectedRevision: 1, assessmentDigest: digest, reason: '独立备份也无法恢复', confirmation: 'accept-loss' };
  expect(ConfirmFinalizationLossSchema.safeParse(loss).success).toBe(true);
  for (const bad of [{ reason: '' }, { assessmentDigest: undefined }, { confirmation: undefined }, { expectedRevision: 0 }]) expect(ConfirmFinalizationLossSchema.safeParse({ ...loss, ...bad }).success).toBe(false);
});

test('清单分页拒绝重复路径、重复别名、超页大小和未知字段', () => {
  const file = { kind: 'file', path: 'out/result.json', name: 'result' };
  const page = { requestKey: 'page', expectedRevision: 1, page: 0, entries: [file] };
  expect(ArchivePlanPageSchema.parse(page).entries[0]).toHaveProperty('required', true);
  expect(ArchivePlanPageSchema.safeParse({ ...page, entries: [file, { ...file, name: 'other' }] }).success).toBe(false);
  expect(ArchivePlanPageSchema.safeParse({ ...page, entries: [file, { kind: 'object', objectId: id, name: 'result' }] }).success).toBe(false);
  expect(ArchivePlanPageSchema.safeParse({ ...page, entries: Array.from({ length: 101 }, (_, i) => ({ ...file, path: `file${i}`, name: `file${i}` })) }).success).toBe(false);
  expect(ArchivePlanPageSchema.safeParse({ ...page, bucket: 'other' }).success).toBe(false);
  expect(SealedArchivePlanSchema.safeParse({ planId: id, planRevision: 1, digest }).success).toBe(true);
});

test('修订清单不能顺便更改业务 outcome 或拿迁移停止权限扩大写权', () => {
  const input = { requestKey: 'revise', expectedGeneration: 2, expectedRevision: 1, archive: finalize.archive, reason: '修正文件名' };
  expect(ReviseBusinessArchiveSchema.parse(input).confirmDiscard).toBe(false);
  expect(ReviseBusinessArchiveSchema.safeParse({ ...input, outcome: 'failed' }).success).toBe(false);
  expect(ReviseBusinessArchiveSchema.safeParse({ ...input, stopAuthority: { operationId: id, epoch: 1 } }).success).toBe(false);
});
