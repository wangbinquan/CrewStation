import {text,bigint,primaryKey,index} from 'drizzle-orm/pg-core';
import {jsonDocument} from '@crewstation/persistence';
import type {NativeActivityEvent} from '@crewstation/contracts';
import {devSessionSchema} from '../schema';
export const observationActivityHistory=devSessionSchema.table('observation_activity_history',{taskId:text('task_id').notNull(),sourceTaskId:text('source_task_id').notNull(),sourceSeq:bigint('source_seq',{mode:'number'}).notNull(),agentId:text('agent_id').notNull(),eventId:text('event_id').notNull(),document:jsonDocument('document').$type<NativeActivityEvent>().notNull()},t=>[primaryKey({columns:[t.sourceTaskId,t.sourceSeq]}),index('observation_activity_agent').on(t.taskId,t.agentId,t.sourceTaskId,t.sourceSeq)]);
