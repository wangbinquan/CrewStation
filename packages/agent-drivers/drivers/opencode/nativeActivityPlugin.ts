/** 运行时写入 CLI 私有目录的原生插件。默认导出是 OpenCode 插件协议的要求。 */
const QUEUE = String.raw`
  let sequence = 0, draining = false, closed = false;
  const queue = [];
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length && !closed) {
        try {
          const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json',authorization:'Bearer '+token}, body:queue[0], signal:AbortSignal.timeout(2000)});
          if (!response.ok) throw new Error('observer unavailable');
          queue.shift();
        } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
      }
    } finally { draining = false; }
  }
  function send(event) {
    if (closed) return;
    const item = JSON.stringify({protocol:1, sequence:++sequence, event});
    if (queue.length < 256) queue.push(item);
    void drain();
  }
  const roots = new Map();
  function register(info) {
    if (!info || typeof info.id !== 'string') throw new Error('session identity absent');
    if (roots.size >= 128 && !roots.has(info.id)) throw new Error('session limit');
    roots.set(info.id, info.parentID ?? null);
    send({type:'session',eventId:'session:'+info.id,sessionId:info.id,parentId:info.parentID ?? null,at:new Date().toISOString()});
  }
  send({type:'ready'});
  const heartbeat = setInterval(() => send({type:'heartbeat'}), 5000);
  heartbeat.unref?.();
`;

const HOOKS = String.raw`
  return {
    'chat.message': async (input, output) => {
      try {
        const message = output.message;
        if (!roots.has(input.sessionID)) {
          const result = await client.session.get({path:{id:input.sessionID}});
          register(result.data);
        }
        send({type:'prompt',eventId:'prompt:'+message.id,sessionId:input.sessionID,messageId:message.id,at:new Date(message.time.created).toISOString()});
      } catch { send({type:'gap'}); }
    },
    event: async ({event}) => {
      try {
        if (event.type === 'server.instance.disposed') { closed = true; clearInterval(heartbeat); queue.length = 0; return; }
        if (!['session.created','session.status','message.updated','question.asked','question.replied','question.rejected','permission.asked','permission.replied'].includes(event.type)) return;
        const p = event.properties;
        if (event.type === 'session.created') { register(p.info); return; }
        const base = {eventId:event.id,sessionId:p.sessionID,at:new Date().toISOString()};
        if (event.type === 'session.status') send({...base,type:'status',status:p.status.type});
        if (event.type === 'message.updated' && p.info.role === 'assistant') {
          const i = p.info;
          send({...base,type:'assistant',messageId:i.id,parentId:i.parentID,createdAt:i.time.created,completed:typeof i.time.completed === 'number',...(i.finish ? {finish:i.finish} : {}),...(i.error ? {error:i.error.name} : {})});
        }
        if (event.type === 'question.asked' || event.type === 'permission.asked') send({...base,type:'request',requestId:p.id,requestKind:event.type === 'question.asked' ? 'question' : 'permission',...(p.tool?.messageID ? {messageId:p.tool.messageID} : {})});
        if (event.type === 'question.replied' || event.type === 'question.rejected' || event.type === 'permission.replied') send({...base,type:'resolved',requestId:p.requestID,resolution:event.type === 'question.rejected' || p.reply === 'reject' ? 'rejected' : 'answered'});
      } catch { send({type:'gap'}); }
    },
  };
`;

export function renderOpencodeActivityPlugin(endpoint: string, token: string): string {
  return `export default async function({client}) {\nconst endpoint = ${JSON.stringify(endpoint)}, token = ${JSON.stringify(token)};\n${QUEUE}\n${HOOKS}\n}`;
}
