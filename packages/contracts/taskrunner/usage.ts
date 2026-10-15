import { z } from 'zod';

// RFC-034 v2（proposal/rfc/RFC-034-runtime-observability/redesign-v2-20261014.md §3–§4）：
// 一次 Agent 执行到目前为止的用量，按运行时实际报告的模型拆分，整份替换上一份。
// 与 agent-workflow RFC-371 v2 的 RuntimeUsageSnapshot 同形同义：推理是输出的子集，未知不是 0。

const tokens = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const AgentUsageModelSchema = z.strictObject({
  /** 运行时实际报告的模型（OpenCode 为 provider/model，Claude Code 为模型名）；空串表示未归属。 */
  model: z.string().max(300),
  input: tokens,
  cacheRead: tokens,
  cacheWrite: tokens,
  /** 含推理。 */
  output: tokens,
  /** 输出中已知的推理部分，不另行相加。 */
  reasoning: tokens,
}).refine((row) => row.reasoning <= row.output, { message: '推理是输出的子集', path: ['reasoning'] });

export const AgentUsageSnapshotSchema = z.strictObject({
  /** complete：覆盖本次执行到目前为止的全部用量；partial：已知下界。 */
  state: z.enum(['partial', 'complete']),
  models: z.array(AgentUsageModelSchema).max(100),
});

export type AgentUsageModel = z.infer<typeof AgentUsageModelSchema>;
export type AgentUsageSnapshot = z.infer<typeof AgentUsageSnapshotSchema>;
