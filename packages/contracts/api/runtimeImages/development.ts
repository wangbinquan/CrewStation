import type { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { OpenDevSessionRequestSchema, StartDevAgentRequestSchema } from '../devSession';
import { StartNativeTerminalRequestSchema } from '../nativeTerminal';

/** 显式选择仅在 v2 路由接收，旧平台不能静默丢弃字段。 */
export const OpenDevSessionV2RequestSchema = OpenDevSessionRequestSchema.extend({ runtimeImageVersionId: ResourceIdSchema.optional() }).strict();
export const StartDevAgentV2RequestSchema = StartDevAgentRequestSchema.extend({ runtimeImageVersionId: ResourceIdSchema.optional() }).strict();
export const StartNativeTerminalV2RequestSchema = StartNativeTerminalRequestSchema.extend({ runtimeImageVersionId: ResourceIdSchema.optional() }).strict();
export type OpenDevSessionV2Request = z.infer<typeof OpenDevSessionV2RequestSchema>;
export type StartDevAgentV2Request = z.infer<typeof StartDevAgentV2RequestSchema>;
export type StartNativeTerminalV2Request = z.infer<typeof StartNativeTerminalV2RequestSchema>;
