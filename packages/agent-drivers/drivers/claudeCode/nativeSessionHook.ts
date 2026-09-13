/** Claude 的 SessionStart 只支持 command／mcp_tool，不能给它配置 HTTP hook。 */
export function renderClaudeSessionHook(endpoint: string): string {
  return `let bytes = 0, chunks = [];
try {
  for await (const chunk of Bun.stdin.stream()) {
    bytes += chunk.length;
    if (bytes > 131072) throw new Error('observer input capacity');
    chunks.push(chunk);
  }
  const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const body = Object.fromEntries(['hook_event_name','session_id','agent_id','transcript_path'].filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
  await fetch(${JSON.stringify(`${endpoint}/hooks`)}, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(3000)});
} catch { /* 观察失败不改变 CLI 的启动／原生操作。 */ }
`;
}

export function claudeSessionHookCommand(path: string): string {
  return `bun '${path.replaceAll("'", "'\\''")}'`;
}
