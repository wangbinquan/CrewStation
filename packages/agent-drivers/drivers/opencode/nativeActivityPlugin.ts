/** 运行时写入 CLI 私有目录的原生插件。默认导出是 OpenCode 插件协议的要求。 */
const QUEUE = String.raw`
  let eventSequence=0;const generation=crypto.randomUUID();
  let sequence = 0, draining = false, closed = false;
  const queue = [];
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length && !closed) {
        try {
          const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json',authorization:'Bearer '+token}, body:queue[0].body, signal:AbortSignal.timeout(2000)});
          if (!response.ok) throw new Error('observer unavailable');
          queue.shift().resolve();
        } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
      }
    } finally { draining = false; }
  }
  function send(event) {
    if (closed) return;
    return new Promise(resolve => { const item = {body:JSON.stringify({protocol:1,sequence:++sequence,event}),resolve}; queue.push(item); void drain(); });
  }
  const roots = new Map();
  async function register(info) {
    if (!info || typeof info.id !== 'string') throw new Error('session identity absent');
    roots.set(info.id, info.parentID ?? null);
    await send({type:'session',eventId:'session:'+info.id,sessionId:info.id,parentId:info.parentID ?? null,at:new Date().toISOString()});
  }
  send({type:'ready'});
  const heartbeat = setInterval(() => {if(!queue.length)void send({type:'heartbeat'});}, 5000);
  heartbeat.unref?.();
`;

const HOOKS = String.raw`
  return {
    'chat.message': async (input, output) => {
      try {
        const message = output.message;
        if (!roots.has(input.sessionID)) {
          const result = await client.session.get({path:{id:input.sessionID}});
          await register(result.data);
        }
        await send({type:'prompt',eventId:'prompt:'+message.id,sessionId:input.sessionID,messageId:message.id,at:new Date(message.time.created).toISOString()});
      } catch { send({type:'gap'}); }
    },
    event: async ({event}) => {
      try {
        if (event.type === 'server.instance.disposed') { closed = true; clearInterval(heartbeat); queue.length = 0; return; }
        if (!['session.created','session.status','message.updated','message.part.updated','question.asked','question.replied','question.rejected','permission.asked','permission.replied'].includes(event.type)) return;
        const p = event.properties;
        if (event.type === 'session.created') { await register(p.info); return; }
        const nativeSession=p.sessionID??p.info?.sessionID??p.part?.sessionID;
        const base = {eventId:generation+':'+(++eventSequence),sessionId:nativeSession,at:new Date().toISOString()};
        if(event.type==='message.part.updated'&&p.part?.type==='tool'&&['running','completed','error'].includes(p.part.state?.status)){const tool=p.part;await send({...base,type:'tool',callId:tool.callID,messageId:tool.messageID,name:tool.tool,state:tool.state.status,at:new Date(tool.state.status==='running'?tool.state.time.start:tool.state.time.end).toISOString()});return;}
        if (event.type === 'session.status') await send({...base,type:'status',status:p.status.type});
        if (event.type === 'message.updated' && p.info.role === 'assistant') {
          const i = p.info;
          await send({...base,type:'assistant',messageId:i.id,parentId:i.parentID,createdAt:i.time.created,completed:typeof i.time.completed === 'number',...(i.finish ? {finish:i.finish} : {}),...(i.error ? {error:i.error.name} : {})});
        }
        if (event.type === 'question.asked' || event.type === 'permission.asked') await send({...base,type:'request',requestId:p.id,requestKind:event.type === 'question.asked' ? 'question' : 'permission',...(p.tool?.messageID ? {messageId:p.tool.messageID} : {})});
        if (event.type === 'question.replied' || event.type === 'question.rejected' || event.type === 'permission.replied') await send({...base,type:'resolved',requestId:p.requestID,resolution:event.type === 'question.rejected' || p.reply === 'reject' ? 'rejected' : 'answered'});
      } catch { send({type:'gap'}); }
    },
  };
`;

export function renderOpencodeActivityPlugin(endpoint: string, token: string): string {
  return `export default async function({client}) {\nconst endpoint = ${JSON.stringify(endpoint)}, token = ${JSON.stringify(token)};\n${QUEUE}\n${HOOKS}\n}`;
}
