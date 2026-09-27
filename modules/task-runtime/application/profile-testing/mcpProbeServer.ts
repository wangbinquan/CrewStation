import { BusinessExecutionInfoSchema, businessCommandDigestInput } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { readProbeEvents } from './businessProbeTurns';
import type { BusinessProbeTurnDeps } from './businessProbeTurns';

/** Private, loopback-only JSON-RPC test tool. It receives no tenant material or credentials. */
export async function startMcpProbe(deps: BusinessProbeTurnDeps, token: string): Promise<string> {
  const executionId = newResourceId(), info = BusinessExecutionInfoSchema.parse(await deps.runner.sendCommand(deps.taskId, { id: newResourceId(), type: 'businessExecutionInfo' }));
  const source = `Bun.serve({hostname:'127.0.0.1',port:18089,async fetch(req){if(req.method!=='POST')return new Response('',{status:405});const q=await req.json();if(q.id===undefined)return new Response(null,{status:202});let result;if(q.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'crewstation-probe',version:'1'}};else if(q.method==='tools/list')result={tools:[{name:'nonce',description:'Get the capability probe token',inputSchema:{type:'object',properties:{}}}]};else if(q.method==='tools/call')result={content:[{type:'text',text:${JSON.stringify(token)}}]};else result={};return Response.json({jsonrpc:'2.0',id:q.id,result});}});console.log('CS_MCP_PROBE_READY');`;
  const payload = { command: ['bun', '-e', source], env: {}, timeoutSeconds: 900 };
  const payloadDigest = new Bun.CryptoHasher('sha256').update(businessCommandDigestInput(payload)).digest('hex');
  try {
    try { await deps.runner.sendCommand(deps.taskId, { id: newResourceId(), type: 'startBusinessCommand', executionId, attempt: 1, incarnation: info.incarnation, payloadDigest, ...payload }); }
    catch { /* Reconcile this identity after an uncertain start response. */ }
    await awaitListening(deps, executionId);
    return executionId;
  } catch (error) {
    await deps.runner.sendCommand(deps.taskId, { id: newResourceId(), type: 'cancelBusinessExecution', executionId }).catch(() => undefined);
    throw error;
  }
}

async function awaitListening(deps: BusinessProbeTurnDeps, executionId: string): Promise<void> {
  const deadline = Date.now() + Math.min(10_000, deps.budgetMs);
  let after = 0, output = '';
  for (;;) {
    if (!await deps.heartbeat()) throw new Error('MCP 测试服务器租约丢失');
    const { stored, page } = await readProbeEvents(deps, executionId, after), receipt = stored.receipt;
    for (const event of page) {
      if (event.sequence !== after + 1) throw new Error('MCP 测试服务器事件不连续');
      after = event.sequence;
      if (event.frame.type === 'output') output += event.frame.text;
    }
    if (receipt.phase === 'unknown' || receipt.phase === 'finished') throw new Error('MCP 测试服务器未能保持运行');
    if (output.includes('CS_MCP_PROBE_READY')) return;
    if (output.length > 32768 || Date.now() >= deadline) throw new Error('MCP 测试服务器未在时限内监听');
    await Bun.sleep(deps.pollMs);
  }
}
