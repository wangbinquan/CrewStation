import type { Page } from './cdp';
import { runtimeStatisticsFixture } from '../../apps/console/src/tests/runtimeStatisticsFixture';

/** Browser geometry uses the production app with bounded HTTP fixtures; it creates no cluster tasks. */
export async function installRuntimeStatisticsFixture(page: Page) {
  const original = globalThis.fetch;
  const f = runtimeStatisticsFixture();
  const paths = ['/v1/me', '/v1/projects', '/v1/projects/page', '/v1/projects/' + f.projectId,
    '/v1/admin/observability/statistics?' + f.query, '/v1/projects/' + f.projectId + '/observability/statistics?' + f.query,
    ...f.details.map((task) => '/v1/admin/observability/tasks/' + task.id)];
  let responses: Record<string, unknown>;
  try { responses = Object.fromEntries(await Promise.all(paths.map(async (path) => [path.split('?')[0]!, await (await fetch(path)).json()]))); }
  finally { globalThis.fetch = original; }
  const source = `(() => {
    const responses = ${JSON.stringify(responses)}, original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (!url.pathname.startsWith('/v1/')) return original(input, init);
      if ((init?.method ?? 'GET') !== 'GET') throw new Error('Observation fixture permits reads only');
      return new Response(JSON.stringify(responses[url.pathname] ?? {items:[]}), {status:200,headers:{'content-type':'application/json'}});
    };
  })()`;
  await page.cmd('Page.addScriptToEvaluateOnNewDocument', { source });
  return { projectId: f.projectId, taskId: f.details[0]!.id, query: f.query };
}

export async function measureRuntimeOverview(page: Page) {
  return page.eval<{ overflow: number; mainOverflow: number; gap: number; expectedGap: number; sectionGap: number; expectedSectionGap: number; bars: number; chartOverflow: number; tokenLabels: string[]; alignedRange: boolean; noExport: boolean }>(`(() => {
    const grid = document.querySelector('[data-runtime-metrics]'), cards = [...grid.children];
    const a = cards[0].getBoundingClientRect(), b = cards[1].getBoundingClientRect();
    const chart = document.querySelector('[data-runtime-statistics] [role="tabpanel"] [role="group"]');
    const rect = chart.getBoundingClientRect(), bars = [...chart.querySelectorAll('button')];
    const main = document.querySelector('main'), trend = chart.closest('section');
    const input = document.querySelector('input[type="datetime-local"]'), row = input.closest('label').parentElement, apply = row.querySelector('button');
    const alignedRange = getComputedStyle(row).alignItems === 'flex-end' && (innerWidth < 800 || Math.abs(input.getBoundingClientRect().bottom-apply.getBoundingClientRect().bottom)<1);
    return {overflow:document.documentElement.scrollWidth-innerWidth,mainOverflow:main.scrollWidth-main.clientWidth,
      gap:Math.abs(a.top-b.top)<1 ? b.left-a.right : b.top-a.bottom,
      sectionGap:trend.getBoundingClientRect().top-grid.getBoundingClientRect().bottom,
      expectedSectionGap:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cs-space-3')),
      expectedGap:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cs-space-4')),
      bars:bars.length,chartOverflow:Math.max(0,...bars.map(bar=>bar.getBoundingClientRect().right-rect.left-chart.parentElement.scrollWidth)),
      tokenLabels:bars.map(bar=>bar.firstElementChild.textContent),alignedRange,noExport:![...document.querySelectorAll('button')].some(b=>/CSV/.test(b.textContent))};
  })()`);
}
