import type {RuntimeCompleteReport} from '@crewstation/contracts';
import {useT} from '../../../shared/lib/useT';
import {Card} from '../../../shared/ui/Card';
import styles from './RuntimeStatistics.module.css';
export function RuntimeReportState({report}:{report:RuntimeCompleteReport}) {
 const t=useT();if(report.state==='ready')return null;
 return <Card title={t('runtime.report.'+report.state)} stacked><p role={report.state==='failed'?'alert':'status'} className={styles.hint}>{t('runtime.report.noPartial')}</p>
  {report.state==='building'?<p>{t('runtime.report.phase.'+report.phase)}</p>:report.state==='failed'?<p>{report.error}</p>:<ul>{report.gaps.map((gap,index)=><li key={index}>{t('runtime.reason.'+gap.reason)}<span className={styles.identity}>{gap.source}</span></li>)}</ul>}
 </Card>;
}
