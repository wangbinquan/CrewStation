import type { ComputeProfileSummaryDto } from '@crewstation/contracts';

/** 两个入口：「＋ CLI」列出全部档位；headless Agent（历史对话）只能用解析事件与会话的两种协议（RFC-006 C6）。 */
export type ComputeUse = 'cli' | 'agent';

export function choicesFor(items: readonly ComputeProfileSummaryDto[], use: ComputeUse): ComputeProfileSummaryDto[] {
  return use === 'agent' ? items.filter((item) => !item.terminalOnly) : [...items];
}

/**
 * 选中值实际指向的档位：空值即「默认档位」，启动时由服务端解析（C17），这里只用来提前显示它能不能用。
 * 默认档位不会是通用终端协议（服务端不允许），所以两个入口用同一条规则。
 */
export function resolveChoice(items: readonly ComputeProfileSummaryDto[], value: string): ComputeProfileSummaryDto | undefined {
  return value === '' ? items.find((item) => item.isDefault) : items.find((item) => item.id === value);
}

/** 不能启动的原因：平台没设默认档位、所选档位已不在列表里、或所选档位当前不可用（停用／测试中／测试失败／未测试）。 */
export type ChoiceBlock = 'no-default' | 'missing' | 'unavailable';

export function choiceBlocked(items: readonly ComputeProfileSummaryDto[], value: string): ChoiceBlock | undefined {
  const target = resolveChoice(items, value);
  if (!target) return value === '' ? 'no-default' : 'missing';
  return target.available ? undefined : 'unavailable';
}
