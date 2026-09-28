import { useEffect, useState } from 'react';
import { Stack } from '../../../../apps/console/src/shared/ui/Stack';
import { Card } from '../../../../apps/console/src/shared/ui/Card';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { PageHeader } from '../../../../apps/console/src/shared/ui/PageHeader';
import { DataTable } from '../../../../apps/console/src/shared/ui/DataTable';
import { ActionNote } from '../../../../apps/console/src/shared/ui/ActionNote';
import { Notice } from './Metrics';
import { PricingForm } from './PricingForm';
import { draftVersion, initialRateVersions, nextRateDraft, pricingProfiles, rateDraftError, rateFields } from './pricingCatalog';
import type { PricingKey, RateDraft } from './pricingCatalog';

export function PricingView({ active, onBack }: { active: boolean; onBack: () => void }) {
  const [versions, setVersions] = useState(initialRateVersions);
  const [selected, setSelected] = useState<PricingKey | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<PricingKey, RateDraft>>>({});
  const [error, setError] = useState<string | null>(null), [saved, setSaved] = useState('');
  useEffect(() => { if (!active) setSelected(null); }, [active]);
  if (!active) return null;
  const edit = (key: PricingKey) => { setDrafts((d) => ({ ...d, [key]: d[key] ?? nextRateDraft(key, versions) })); setError(null); setSelected(key); };
  const save = () => {
    if (!selected) return;
    const draft = drafts[selected]!, problem = rateDraftError(draft, selected, versions);
    if (problem) { setError(problem); return; }
    const version = draftVersion(selected, draft, versions);
    setVersions((v) => [...v, version]);
    setSaved(pricingProfiles.find((p) => p.key === selected)!.name + ' 的 CNY-v' + version.version + ' 已保存到演示会话，计划于 ' + version.effectiveAt.replace('T', ' ') + ' 生效。历史费用未改动。');
    setDrafts((d) => ({ ...d, [selected]: undefined })); setSelected(null);
  };
  return <Stack>
    <div className="breadcrumb">系统管理 / 算力档位 / Token 成本</div>
    <PageHeader title="Token 成本配置" description="按算力档位绑定的运行时与模型配置人民币单价，供项目、任务和 Agent 成本归因使用。"
      actions={<Button onClick={onBack}>返回成本统计</Button>}/>
    <Notice>人民币（CNY） · 元 / 百万 Token。相同运行时可调用不同模型，因此每个档位分别定价。镜像构建和纯终端没有可计量模型用量时标为“不适用 / 不支持”。</Notice>
    {saved && <ActionNote tone="success">{saved}</ActionNote>}
    <Card compact stacked title="运行时与档位价格" extra={<Badge tone="warning">人民币示例价格</Badge>}>
      <DataTable className="pricingTable" columns={['算力档位 / 运行时', '模型服务 / 模型', '非缓存输入', '缓存读取', '缓存写入', '输出', '价格版本', '操作']}>
        {pricingProfiles.map((p) => {
          const activeRate = versions.find((v) => v.key === p.key && v.version === 1)!;
          const pending = versions.filter((v) => v.key === p.key && v.version > 1).length;
          return <tr key={p.key}><td><strong>{p.name}</strong><small>{p.runtime}</small></td><td>{p.provider}<small>{p.model}</small></td>
            {rateFields.map(({ key }) => <td key={key} className="numeric">¥{activeRate.rates[key]}</td>)}
            <td>CNY-v1<small>{pending ? pending + ' 个待生效版本' : '当前生效'}</small></td>
            <td><Button size="small" onClick={() => edit(p.key)}>配置单价</Button></td></tr>;
        })}
        <tr><td><strong>通用终端 · r2</strong><small>Terminal</small></td><td>未报告模型</td><td colSpan={4}>— · 不支持 Token 计量</td><td>未配置</td><td><span className="muted small">先接入可验证的用量来源</span></td></tr>
      </DataTable>
      <p className="muted small">四桶互斥；reasoning 已包含在输出内。未知单价不能填成 0；固定订阅费用另列，不反推每个 Token 的精确成本。</p>
    </Card>
    <Card compact title="价格版本历史 · 当前演示会话">
      <DataTable className="pricingHistory" columns={['档位', '版本', '生效时间（UTC+08:00）', '非缓存输入', '缓存读', '缓存写', '输出', '状态']}>
        {[...versions].reverse().map((v) => <tr key={v.key + v.version}><td>{pricingProfiles.find((p) => p.key === v.key)!.name}</td><td>CNY-v{v.version}</td><td>{v.effectiveAt.replace('T', ' ')}</td>
          {rateFields.map(({ key }) => <td key={key} className="numeric">¥{v.rates[key]}</td>)}
          <td><Badge tone={v.version === 1 ? 'success' : 'info'}>{v.version === 1 ? '当前生效' : '待生效'}</Badge></td></tr>)}
      </DataTable>
    </Card>
    <p className="muted small">只维护价格记录，不启动模型测试、不修改运行参数。版本保存仅限此浏览器页面会话，刷新恢复示例。</p>
    {selected && drafts[selected] && <PricingForm pricingKey={selected} draft={drafts[selected]!} error={error}
      dirty={JSON.stringify(drafts[selected]) !== JSON.stringify(nextRateDraft(selected, versions))}
      onDraft={(draft) => { setDrafts((d) => ({ ...d, [selected]: draft })); setError(null); }}
      onSave={save} onClose={() => setSelected(null)} onClear={() => { setDrafts((d) => ({ ...d, [selected]: nextRateDraft(selected, versions) })); setError(null); }}/>}
  </Stack>;
}
