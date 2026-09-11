import type { ProjectState, SlotDto } from '@crewstation/contracts';
import type { BadgeTone } from '../../../shared/ui/Badge';

/** 项目状态色：active 成功、provisioning 进行中、failed 用 danger（与降级区分）、暂停与归档中性。 */
export function projectStateTone(state: ProjectState): BadgeTone {
  switch (state) {
    case 'active':
      return 'success';
    case 'provisioning':
      return 'info';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** 部署槽状态色：ready 成功、deploying 进行中、degraded 警告、failed 危险、empty 中性。 */
export function slotStateTone(state: SlotDto['state']): BadgeTone {
  switch (state) {
    case 'ready':
      return 'success';
    case 'deploying':
      return 'info';
    case 'degraded':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** 提交号在界面上一律取前 7 位；未部署时显示占位符。 */
export function shortSha(sha: string | undefined): string {
  return sha === undefined || sha.length === 0 ? '—' : sha.slice(0, 7);
}
