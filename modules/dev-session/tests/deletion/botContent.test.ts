import { describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('Bot metadata follows original project deletion fencing', () => {
  test('a reserved execution without AgentStart is inventoried; sealing blocks late writes and parent rewrites', async () => {
    const f = await developmentWorkFixture();
    try {
      const id = newResourceId(), requestId = newResourceId(), agentId = newResourceId(), executionTaskId = newResourceId();
      const conversation = { id, taskId: f.workspace }, operation = { requestId, taskId: f.workspace, receipt: { conversationId: id } }, execution = { agentId, taskId: f.workspace, executionTaskId, conversationId: id };
      await f.work.run(f.input(), async () => {
        await f.database.db.execute(sql`INSERT INTO dev_session.bot_conversations(task_id,id,revision,data) VALUES(${f.workspace},${id},1,${JSON.stringify(conversation)}::jsonb)`);
        await f.database.db.execute(sql`INSERT INTO dev_session.bot_messages(task_id,request_id,state,data) VALUES(${f.workspace},${requestId},'accepted',${JSON.stringify(operation)}::jsonb)`);
        await f.database.db.execute(sql`INSERT INTO dev_session.bot_executions(task_id,agent_id,execution_task_id,data) VALUES(${f.workspace},${agentId},${executionTaskId},${JSON.stringify(execution)}::jsonb)`);
      });
      const snapshot = await f.inspect();
      expect(snapshot.contents.filter(c => c.table.startsWith('bot_'))).toHaveLength(3);
      expect(snapshot.origins).toContainEqual(expect.objectContaining({ kind: 'task', key: executionTaskId, projectId: f.project }));
      await expect(f.database.db.execute(sql`UPDATE dev_session.bot_executions SET execution_task_id=${newResourceId()} WHERE agent_id=${agentId}`).then(() => undefined)).rejects.toThrow();
      const confirmed = await f.owner().inspect(f.target); expect((await f.owner().run(f.context(confirmed))).kind).toBe('done');
      for (const mutation of [sql`UPDATE dev_session.bot_conversations SET revision=2 WHERE task_id=${f.workspace}`, sql`UPDATE dev_session.bot_messages SET state='dispatched' WHERE request_id=${requestId}`, sql`UPDATE dev_session.bot_executions SET data=data||'{"state":"running"}'::jsonb WHERE agent_id=${agentId}`]) await expect(f.database.db.execute(mutation).then(() => undefined)).rejects.toThrow();
      expect((await f.inspect()).contents.filter(c => c.table.startsWith('bot_'))).toHaveLength(3);
    } finally { await f.drop(); }
  });
});
