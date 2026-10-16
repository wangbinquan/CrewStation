import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { boundedStartupInventory, STARTUP_INVENTORY_BYTES } from '@crewstation/contracts';
import type { BusinessStartupInventory } from '@crewstation/contracts';

/** A zero-dependency plugin. Every face comes from the same in-process runtime client, never configuration. */
export function renderStartupInventoryPlugin(output: string, nonce: string): string {
  return `import { writeFile, rename } from 'node:fs/promises';
const output=${JSON.stringify(output)}, nonce=${JSON.stringify(nonce)}, limit=${STARTUP_INVENTORY_BYTES};
const StartupInventoryPlugin = { id:'crewstation-startup-inventory', async server({client}) {
  let captured=false;
  return { 'chat.message': async (input) => {
    if(captured) return;
    let session;
    try { const r=await client.session.get({path:{id:input.sessionID}}); if(r.error || !r.data || r.data.id!==input.sessionID || r.data.parentID) return; session=r.data.id; } catch { return; }
    captured=true;
    let inventory;
    try {
      if(typeof client.mcp?.status!=='function') throw new Error();
      const response=await client.mcp.status();
      if(response.error || !response.data || typeof response.data!=='object' || Array.isArray(response.data)) throw new Error();
      const mcpServers=Object.entries(response.data).map(([name,value])=>({name,status:['connected','failed','disabled','unknown'].includes(value?.status)?value.status:['needs_auth','needs_client_registration'].includes(value?.status)?'failed':'unknown'}));
      inventory={version:1,state:'verified',source:'opencode-inventory',mcpServers};
      for(const [face,method] of [['agents','agents'],['skills','skills']]) if(typeof client.app?.[method]==='function') {
        try { const r=await client.app[method](); if(!r.error && Array.isArray(r.data)) inventory[face]=r.data.map(x=>x.name); } catch {}
      }
    } catch { inventory={version:1,state:'unavailable',reason:'inventory-unavailable'}; }
    if(new TextEncoder().encode(JSON.stringify(inventory)).byteLength>limit) inventory={version:1,state:'unavailable',reason:'inventory-too-large'};
    try { const tmp=output+'.'+nonce+'.tmp'; await writeFile(tmp,JSON.stringify({nonce,sessionId:session,inventory}),{mode:0o600}); await rename(tmp,output); } catch {}
  }};
}};
export { StartupInventoryPlugin as default };
`;
}
/** Read only this attempt's bounded regular file; its private nonce and root session must both match. */
export function readStartupInventory(path: string, nonce: string, sessionId: string | undefined): BusinessStartupInventory {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { version: 1, state: 'malformed', reason: 'inventory-malformed' };
    if (stat.size > STARTUP_INVENTORY_BYTES + 4096) return { version: 1, state: 'unavailable', reason: 'inventory-too-large' };
    const buffer = Buffer.alloc(STARTUP_INVENTORY_BYTES + 4097), bytes = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytes > STARTUP_INVENTORY_BYTES + 4096) return { version: 1, state: 'unavailable', reason: 'inventory-too-large' };
    const raw = JSON.parse(buffer.toString('utf8', 0, bytes));
    if (!raw || typeof raw !== 'object' || raw.nonce !== nonce || !sessionId || raw.sessionId !== sessionId) return { version: 1, state: 'malformed', reason: 'inventory-identity-mismatch' };
    const inventory = boundedStartupInventory(raw.inventory);
    return inventory.state === 'verified' && inventory.source !== 'opencode-inventory' ? { version: 1, state: 'malformed', reason: 'inventory-malformed' } : inventory;
  } catch (error) {
    return { version: 1, state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'unavailable' : 'malformed', reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'inventory-not-reported' : 'inventory-malformed' };
  } finally { if (fd !== undefined) closeSync(fd); }
}
