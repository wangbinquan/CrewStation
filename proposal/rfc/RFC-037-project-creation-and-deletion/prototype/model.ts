/** 交互稿只使用演示数据，不连接平台 API。域名按现有 HostNaming 模式展示。 */
export const DEMO_DOMAIN = 'apps.example.cn';
export const TEMPLATES = [
  { id: 'minimal-sample', name: '基础应用', sourceName: 'minimal-sample', tag: '通用起点', description: '从基础应用骨架开始，包含页面、API 和发布配置。你可以在此基础上继续开发。', items: ['应用页面', 'API 示例', '发布配置'] },
  { id: 'business-execution-v3', name: '业务执行示例', sourceName: 'business-execution-v3', tag: '进阶示例', description: '演示后台业务任务、异步命令与版本交接。适合需要理解平台业务执行流程的开发者。', items: ['后台任务', '异步命令', '版本交接'] },
] as const;

export interface Draft { name: string; slug: string; owner: string; template: string; plan: string; quota: string }
export const initialDraft = (): Draft => ({ name: '', slug: '', owner: 'me', template: 'minimal-sample', plan: 'default', quota: '6' });
export const validSlug = (value: string): boolean => /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(value) && !['console', 'preview', 'dev', 'registry', 'api', 'events', 'auth', 'crewstation', 'www', 'mcp-capabilities', 'mcp-operations'].includes(value);

export const PROJECTS = [
  ['知识库助手', 'knowledge-assistant', '把团队文档变成可检索的知识库', '李琳'],
  ['周报助手', 'weekly-report', '整理工作进展，生成每周团队报告', '陈舟'],
  ['客户反馈分析', 'customer-feedback', '归纳反馈主题，发现需要关注的问题', '林悦'],
  ['工单分流', 'ticket-routing', '识别工单类型，分配到对应团队', '李琳'],
  ['合同信息提取', 'contract-extract', '提取条款、主体与重要日期', '林悦'],
  ['演示项目', 'demo-project', '用于查看永久删除的两次确认', '陈舟'],
] as const;

export const DELETION_ITEMS = [
  ['运行资源', '服务两槽、开发会话、任务与 Agent', '8 个实例'],
  ['持久数据', '开发／生产数据库、对象文件与工作盘', '2 个数据库 · 3 个工作盘'],
  ['源码与制品', '源码仓库、项目独占镜像与构建产物', '1 个仓库 · 4 个镜像'],
  ['项目底座', '路由、凭据、配置、授权、成员和命名空间', '全部项目归属记录'],
] as const;
