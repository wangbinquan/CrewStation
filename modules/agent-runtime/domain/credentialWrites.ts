import type { ProfileCredentialWrite } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';

export interface CredentialPlan {
  /** 需要加密后写入的明文。 */
  readonly replace: Array<{ name: string; value: string }>;
  readonly clear: string[];
}

/**
 * keep／replace／clear 三选一：keep 只能用于已有值的名字，clear 对未设置的名字无副作用，也可清掉已取消声明的旧值。
 * 写请求没有提到的已设置凭据一律保留（不会因为界面没列出来就被删）。
 */
export function planCredentialWrites(existing: ReadonlySet<string>, declared: readonly string[], writes: Record<string, ProfileCredentialWrite>): CredentialPlan {
  const plan: CredentialPlan = { replace: [], clear: [] };
  for (const [name, write] of Object.entries(writes)) {
    // clear 允许作用于已不再声明的旧名字：取消声明与删值应能在同一次保存里完成。
    if (write.op !== 'clear' && !declared.includes(name)) throw validation(`凭据 ${name} 未在 secretNames 中声明`, { field: `credentials.${name}` });
    if (write.op === 'keep' && !existing.has(name)) throw validation(`凭据 ${name} 尚未设置，不能保留`, { field: `credentials.${name}` });
    if (write.op === 'replace') plan.replace.push({ name, value: write.value });
    if (write.op === 'clear' && existing.has(name)) plan.clear.push(name);
  }
  return plan;
}
