import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../../../apps/console/src/shared/lib/I18nProvider';
import { DialogHost } from '../../../../apps/console/src/shared/ui/dialog/DialogHost';
import '../../../../apps/console/src/app/theme/tokens.css';
import '../../../../apps/console/src/app/theme/base.css';
import './demo.css';
import { App } from './App';
const catalog={'zh-CN':{'ui.dialog.close':'关闭','ui.dialog.clear':'清空'},'en-US':{'ui.dialog.close':'Close','ui.dialog.clear':'Clear'}};
createRoot(document.getElementById('root')!).render(<I18nProvider catalog={catalog}><DialogHost><App/></DialogHost></I18nProvider>);
