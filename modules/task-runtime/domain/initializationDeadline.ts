import type { WorkloadRender } from './taskEnvironment';

/** 每次启动只记一次期限；重连不能延长，重建启动代次改变后重新计算。 */
export function withInitializationDeadline(render: WorkloadRender, now: Date): WorkloadRender {
  if (!render.runtimeImage || render.runtimeInitializationDeadline?.generation === render.start) return render;
  const image = render.runtimeImage;
  const seconds = 60 + image.initializer.steps.reduce((sum, step) => sum + step.timeoutSeconds, 0) + image.tools.reduce((sum, check) => sum + check.timeoutSeconds, 0);
  return { ...render, runtimeInitializationDeadline: { generation: render.start, at: new Date(now.getTime() + seconds * 1000).toISOString() } };
}
