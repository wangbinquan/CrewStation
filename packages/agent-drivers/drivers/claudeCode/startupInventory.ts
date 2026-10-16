import { boundedStartupInventory } from '@crewstation/contracts';
import type { BusinessStartupInventory } from '@crewstation/contracts';
/** Project only actual root init fields. Diagnostics and unknown properties never cross the event boundary. */
export function claudeStartupInventory(raw: Record<string, unknown>): BusinessStartupInventory {
  if (!Object.hasOwn(raw, 'mcp_servers')) return { version: 1, state: 'unavailable', reason: 'inventory-not-reported' };
  if (!Array.isArray(raw.mcp_servers)) return { version: 1, state: 'malformed', reason: 'inventory-malformed' };
  const servers: Array<{ name: unknown; status: unknown }> = [];
  for (const value of raw.mcp_servers) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: 1, state: 'malformed', reason: 'inventory-malformed' };
    const entry = value as Record<string, unknown>;
    servers.push({ name: entry.name, status: ['connected', 'failed', 'disabled', 'unknown'].includes(String(entry.status)) ? entry.status : 'unknown' });
  }
  return boundedStartupInventory({ version: 1, state: 'verified', source: 'claude-init', mcpServers: servers,
    ...(Object.hasOwn(raw, 'agents') ? { agents: raw.agents } : {}), ...(Object.hasOwn(raw, 'skills') ? { skills: raw.skills } : {}), ...(Object.hasOwn(raw, 'tools') ? { tools: raw.tools } : {}),
  });
}
