import type { ComputeProfileAvailability, ProfileTestDto } from '@crewstation/contracts';

/** 测试还在进行：排队或执行中。保存后服务端自动排测试，页面据此轮询到终态。 */
export function testRunning(test: Pick<ProfileTestDto, 'state'> | undefined): boolean {
  return test !== undefined && (test.state === 'queued' || test.state === 'running');
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** 可用绿、测试中蓝、测试失败红、已停用黄（还能恢复）、未测试灰。 */
export function availabilityTone(state: ComputeProfileAvailability['state']): Tone {
  if (state === 'ready') return 'success';
  if (state === 'testing') return 'info';
  if (state === 'test-failed') return 'danger';
  return state === 'disabled' ? 'warning' : 'neutral';
}

export function testTone(state: ProfileTestDto['state']): Tone {
  if (state === 'passed') return 'success';
  if (state === 'failed') return 'danger';
  if (state === 'unknown') return 'warning';
  return state === 'superseded' ? 'neutral' : 'info';
}


/** 摘要短码：列表里只显示 sha256 的前 12 位，完整值放在 title 里。 */
export function shortDigest(digest: string): string {
  const hex = digest.startsWith('sha256:') ? digest.slice(7) : digest;
  return hex.slice(0, 12);
}
