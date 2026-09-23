import { describe, expect, test } from 'bun:test';
import { consoleSources, sourceAt } from './sourceScan';

const files = consoleSources();
const tenantFiles = files.filter((file) => !file.path.startsWith('features/admin/'));

/**
 * RFC-001 的验收项「工作台新建 Agent 只有档位下拉，全仓搜不到模型自由文本输入」。
 * 类型系统拦不住这件事：契约里去掉 `model` 之后，工作台照样可以加一个模型输入框再把值塞进
 * prompt 或别处。这里改成在源码层断言——回归时会直接指出是哪个文件又把模型搬回了租户面。
 */
describe('工作台不向租户暴露模型与驱动（RFC-001）', () => {
  test('租户面没有模型输入框：只有管理页可以出现 model 字段', () => {
    const offenders = tenantFiles.filter((file) => /\bmodel(Placeholder)?\b\s*[:=]|setModel|'model'|"model"/.test(file.code)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  test('租户面不出现驱动选择：驱动清单只留在管理页', () => {
    const offenders = tenantFiles.filter((file) => /AGENT_DRIVERS|COMPUTE_DRIVERS|'claude-code'|"claude-code"/.test(file.code)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  test('新建 Agent 表单读取当前项目的算力档位目录', () => {
    const form = sourceAt(files, 'agents/StartAgentForm.tsx');
    expect(form.code).toContain('listComputeProfiles(projectId)');
    expect(form.code).toContain("t('devSession.agents.compute')");
  });
});

/**
 * RFC-006：运行环境并入算力档位。类型检查只能证明删掉的 api 不再被调用，挡不住有人照旧写一个
 * 「运行环境」页签或把镜像、二进制搬到租户下拉里——这里在源码层把两件事钉住。
 */
describe('算力档位是唯一的执行配置（RFC-006）', () => {
  test('控制台不再调用运行环境接口，也没有运行环境页签或组件目录', () => {
    expect(files.filter((file) => /\bagentRuntime\b|agent-runtime-configs|RuntimeConfig|admin\.runtime\./.test(file.code)).map((file) => file.path)).toEqual([]);
    expect(files.filter((file) => file.path.startsWith('features/admin/components/runtime/')).map((file) => file.path)).toEqual([]);
    const page = sourceAt(files, 'admin/pages/AdminComputePage.tsx');
    expect(page.code).not.toContain('role="tab"');
    expect(page.code).not.toContain('admin.compute.tab');
    expect(page.code).toContain('ComputeProfilesSection');
  });

  test('租户面的档位下拉只读名称、说明、仅终端与可用性，不读镜像、二进制与模型', () => {
    for (const suffix of ['agents/ComputeOptions.tsx', 'dev-session/model/computeChoices.ts', 'agents/StartAgentForm.tsx', 'native/useCliLauncher.ts', 'native/NewCliButton.tsx']) {
      expect(sourceAt(files, suffix).code).not.toMatch(/binaryPath|imageDigest|\.image\b|\.model\b|protocol/);
    }
    expect(sourceAt(files, 'native/useCliLauncher.ts').code).toContain("choicesFor(profiles.data?.items ?? [], 'cli')");
    expect(sourceAt(files, 'agents/StartAgentForm.tsx').code).toContain("choicesFor(profiles.data?.items ?? [], 'agent')");
  });
});
