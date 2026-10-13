import {z} from 'zod';
import {TaskIdSchema} from '../../ids';
export const RuntimeFragmentSchema=z.strictObject({key:z.string(),taskId:TaskIdSchema,agentId:z.string(),kind:z.enum(['started','session','tool-start','tool-end','permission','status','error','completed','cancelled']),source:z.enum(['agent-driver','native-activity']),occurredAt:z.iso.datetime(),sessionId:z.string().nullable(),parentSessionId:z.string().nullable(),toolId:z.string().nullable(),toolName:z.string().nullable(),status:z.string().nullable(),error:z.boolean().nullable(),sequence:z.string()});
export type RuntimeFragment=z.infer<typeof RuntimeFragmentSchema>;
