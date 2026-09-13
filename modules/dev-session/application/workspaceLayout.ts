import type { Actor, SaveWorkspaceLayoutRequest, TaskId } from '@crewstation/contracts';
import { SaveWorkspaceLayoutRequestSchema } from '@crewstation/contracts';
import { conflict, validation } from '@crewstation/kernel';
import type { NativeTerminalRepository } from '../ports/nativeTerminals';
import type { WorkspaceLayouts } from '../ports/workspaceLayouts';
import type { DevSessionUseCaseDeps } from './dependencies';
import { nativeEnvironment } from './nativeTerminalAccess';

export function workspaceLayoutUseCases(deps: DevSessionUseCaseDeps, layouts: WorkspaceLayouts, terminals: NativeTerminalRepository) {
  return {
    async getWorkspaceLayout(actor: Actor, taskId: TaskId) {
      await nativeEnvironment(deps, actor, taskId, 'view');
      return await layouts.get(taskId, actor.userId) ?? { revision: 0, layout: null, updatedAt: null };
    },
    async saveWorkspaceLayout(actor: Actor, taskId: TaskId, raw: SaveWorkspaceLayoutRequest) {
      await nativeEnvironment(deps, actor, taskId, 'view');
      const parsed = SaveWorkspaceLayoutRequestSchema.safeParse(raw);
      if (!parsed.success) throw validation('布局格式无效', { issues: parsed.error.issues });
      const { expectedRevision, layout } = parsed.data;
      const roster = new Set((await terminals.list(taskId)).map((entry) => entry.record.terminalId));
      const ids = [...layout.tabs.flatMap((tab) => tab.paneOrder), ...layout.hiddenTerminalIds];
      if (ids.some((id) => !roster.has(id))) throw validation('布局只能引用当前开发会话中已启动的 CLI');
      const saved = await layouts.save(taskId, actor.userId, expectedRevision, layout);
      if (!saved) throw conflict('另一窗口已修改你的布局。当前草稿已保留，请查看最新布局或重新应用。');
      return saved;
    },
  };
}
