import { RuntimeImageValidationTargetSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { RuntimeImageRegistry } from '../../ports/registry';
import type { RuntimeImageValidationContext, RuntimeImageValidationExecutor, RuntimeImageValidationResult } from '../../ports/validationExecutor';

/** 服务不用 Runner，也不执行生产迁移。这里只证明产物与启动契约，实际运行仍由发布探针把关。 */
async function serviceContract(registry: RuntimeImageRegistry, registryBase: string, context: RuntimeImageValidationContext): Promise<RuntimeImageValidationResult> {
  const { snapshot, validation } = context, target = RuntimeImageValidationTargetSchema.parse(validation.target);
  if (target.usage !== 'service' || !snapshot.image.startsWith(`${registryBase}/`)) throw precondition('服务验证镜像不属于受管仓库');
  if (snapshot.initializer.steps.length || Object.keys(snapshot.initializer.env).length || snapshot.initializer.secrets.length || snapshot.tools.length) throw precondition('服务镜像通过自己的启动命令和探针初始化，不使用 Runner 初始化与工具清单');
  const repository = snapshot.image.slice(registryBase.length + 1).split('@')[0]!;
  const inspected = await registry.inspect(snapshot.image, snapshot.architecture, { exact: [repository] });
  if (`${inspected.repository}@${inspected.digest}` !== snapshot.image) throw precondition('服务镜像产物摘要不一致');
  return { state: 'passed', verification: 'service-contract', checks: [
    { key: 'registry-artifact', passed: true, output: `${inspected.digest} ${inspected.architecture}`, exitCode: null },
    { key: 'service-startup-contract', passed: true, output: '启动命令、端口和探针合同已校验；实际启动与就绪由发布探针确认', exitCode: null },
  ] };
}

export function validationExecutorWithServices(registry: RuntimeImageRegistry, registryBase: string, runtime?: RuntimeImageValidationExecutor): RuntimeImageValidationExecutor {
  return {
    run: async (context, heartbeat) => {
      if (!await heartbeat()) return { state: 'unknown', checks: [], error: '验证已取消或租约丢失' };
      if (context.validation.target.usage === 'service') return serviceContract(registry, registryBase, context);
      if (!runtime) throw precondition('任务镜像验证执行器尚未配置');
      return runtime.run(context, heartbeat);
    },
    stop: async (context) => context.validation.target.usage === 'service' ? true : runtime ? runtime.stop(context) : false,
  };
}
