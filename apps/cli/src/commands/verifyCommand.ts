import { CHECK_SUITES, SUITE_IDS } from '../cluster/checkSuites';
import type { PhaseReport } from '../cluster/installReport';
import { reportSucceeded } from '../cluster/installReport';
import { operatorContext } from '../cluster/operatorSetup';
import { renderPhaseReports, reportJson, summarize } from '../output/reportOutput';
import { CliFailure, UsageError } from '../runtime/cliError';
import type { CommandContext } from '../runtime/commandContext';
import { enumFlag } from '../runtime/commandContext';

/** Design §11.3 的 `crewstation verify --suite smoke`。跑不了的检查报未实现，不算通过。 */
export async function verify(ctx: CommandContext): Promise<void> {
  const suiteId = enumFlag(ctx, 'suite', SUITE_IDS, 'smoke');
  const suite = CHECK_SUITES.find((item) => item.id === suiteId);
  if (suite === undefined) throw new UsageError(`未知套件 ${suiteId}`, `  可选套件：${SUITE_IDS.join('、')}`);
  const operator = operatorContext(ctx, { requireConfig: false, requireBundle: false });
  const checks = await suite.run({ operator, apiUrl: ctx.settings.apiUrl, fetch: ctx.fetch });
  const reports: readonly PhaseReport[] = [{ id: suite.id, title: suite.title, checks }];
  if (ctx.json) ctx.emit.json(reportJson(reports));
  else summarize(ctx.emit, renderPhaseReports(ctx.emit, reports), `验收套件 ${suite.id}`);
  if (!reportSucceeded(reports)) throw new CliFailure(`套件 ${suite.id} 未全部通过`);
}
