import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BusinessNativeConfigSchema, BusinessClaudeAgentOptionsSchema, BusinessOpencodeAgentOptionsSchema } from '@crewstation/contracts';
import type { BusinessMaterialDownload, BusinessNativeConfig } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { ProcessHost } from '../contract/processHost';
import { materializeBusinessFiles } from './materialFiles';

export interface NativeMaterialFiles { plugins: string[]; dispose(): void }
export async function stageNativeMaterials(native: BusinessNativeConfig | undefined, runDir: string, host: ProcessHost, downloads: readonly BusinessMaterialDownload[], signal?: AbortSignal): Promise<NativeMaterialFiles | undefined> {
  if (!native) return;
  const parsed = BusinessNativeConfigSchema.parse(native), root = mkdtempSync(join(runDir, 'business-native-'));
  const dispose = () => { rmSync(root, { recursive: true, force: true }); };
  try {
    const plugins: string[] = [];
    for (const [index, plugin] of parsed.plugins.entries()) {
      const directory = join(root, String(index));
      await materializeBusinessFiles(directory, plugin.files, downloads, host, signal);
      const entry = join(directory, plugin.entry);
      if (parsed.protocol === 'claude-code') {
        if (!statSync(entry).isDirectory()) throw validation('Claude 插件 entry 必须是包目录', { code: 'invalid_configuration' });
        let manifest: unknown;
        try { const path = join(entry, '.claude-plugin/plugin.json'); if (statSync(path).size > 1024 * 1024) throw new Error('manifest-too-large'); manifest = JSON.parse(readFileSync(path, 'utf8')); } catch { throw validation('Claude 插件缺少有效 manifest', { code: 'invalid_configuration' }); }
        if (!manifest || typeof manifest !== 'object' || !('name' in manifest) || manifest.name !== plugin.name) throw validation('Claude 插件名称与 manifest 不一致', { code: 'invalid_configuration' });
        plugins.push(entry);
      } else plugins.push(pathToFileURL(entry).href);
    }
    await host.chownToWorker(root);
    return { plugins, dispose };
  } catch (error) { dispose(); throw error; }
}
export function opencodeNativeAgents(native: BusinessNativeConfig, systemPrompt: string | undefined, model: string | undefined, base: Record<string, unknown>, models?: Readonly<Record<string, string>>): Record<string, Record<string, unknown>> {
  return Object.fromEntries([native.agent, ...native.subagents].map((agent, index) => [agent.name, {
    ...(index === 0 ? base : {}), ...BusinessOpencodeAgentOptionsSchema.parse(agent.options),
    mode: agent.options.mode ?? (index === 0 ? 'primary' : 'subagent'), description: agent.options.description ?? agent.name,
    prompt: [systemPrompt, agent.body].filter(Boolean).join('\n\n'), ...((models?.[agent.name] ?? model) ? { model: models?.[agent.name] ?? model } : {}),
  }]));
}
/** Models remain platform-owned; every accepted business option is handed to the native parser. */
export function claudeNativeAgents(native: BusinessNativeConfig, model?: string): string {
  const definitions = Object.fromEntries([native.agent, ...native.subagents].map((agent) => [agent.name, { ...BusinessClaudeAgentOptionsSchema.parse(agent.options), description: agent.options.description ?? agent.name, prompt: agent.body, model: model ?? 'inherit' }]));
  const json = JSON.stringify(definitions);
  if (Buffer.byteLength(json) > 120 * 1024) throw validation('当前 Claude 版本的 Agent 参数超过单参数预算', { code: 'unsupported_capability', capability: 'largeAgentDefinitions' });
  return json;
}
