import type { Capability, Change } from './model';

const services = ['service:prod', 'service:preview'];
export const INITIAL_CAPABILITIES: Capability[] = [
  { id: 'service-small', name: 'Small · 服务规格', type: '服务规格', contexts: services, scope: '项目授权；每副本规格', eligibility: 'used', source: '平台默认', value: '1 核 / 2 GiB', effect: '当前正式 2 副本、待验证 1 副本。规格授权不改变运行中的副本。' },
  { id: 'service-medium', name: 'Medium · 服务规格', type: '服务规格', contexts: services, scope: '项目授权', eligibility: 'available', source: '项目分配', value: '2 核 / 4 GiB', effect: '在后续发布中选择；本页只管理授权，不替换当前版本。' },
  { id: 'service-large', name: 'Large · 服务规格', type: '服务规格', contexts: services, scope: '项目授权', eligibility: 'requestable', source: '平台开放申请', value: '4 核 / 8 GiB', effect: '审批生效后成为可选规格；修改发布配置并重新发布后才用于服务。' },
  { id: 'image-base', name: 'Node.js 22 · 运行镜像', type: '运行镜像', contexts: ['dev-work', 'business-work'], scope: '项目授权', eligibility: 'used', source: '平台默认', value: '固定版本 · sha256:7ac…', effect: '新工作区选用指定镜像版本；已运行容器不自动替换。' },
  { id: 'image-python', name: 'Python 数据处理镜像', type: '运行镜像', contexts: ['dev-work', 'business-work'], scope: '项目授权', eligibility: 'requestable', source: '平台开放申请', value: 'Python 3.12 · 工具环境', effect: '授权后可供工作区选择，Agent 执行环境需独立绑定，不因共享工作卷自动继承。' },
  { id: 'task-standard', name: 'Standard · 工作区规格', type: '任务规格', contexts: ['dev-work', 'business-work'], scope: '单工作区', eligibility: 'used', source: '平台默认', value: '0.5 核 / 1 GiB', effect: '新建工作区时使用；项目并发额度由所有工作区和执行共享。' },
  { id: 'compute-default', name: 'OpenCode · 标准算力', type: '算力档位', contexts: ['dev-agents', 'business-agents'], scope: '项目授权；每 Agent', eligibility: 'used', source: '平台默认', value: '0.5 核 / 1 GiB', effect: 'Agent 使用独立的镜像、工具与进程环境；当前执行绑定的修订保持不变。' },
  { id: 'compute-high', name: 'OpenCode · 高配算力', type: '算力档位', contexts: ['dev-agents', 'business-agents'], scope: '项目授权', eligibility: 'requestable', source: '平台开放申请', value: '2 核 / 4 GiB', effect: '批准后用于下一次 Agent 启动；不重启或迁移当前执行。' },
  { id: 'object-capacity', name: '生产对象空间容量', type: '对象存储', contexts: ['objects:prod', ...services], scope: 'space:production（双槽共享）', eligibility: 'used', source: '项目分配', value: '20 GiB', used: 12.6, limit: 20, unit: 'GiB', adjustable: true, effect: '容量修改经后端确认后生效。正式与待验证槽使用同一空间，不重复计算额度。' },
  { id: 'object-plan', name: '大容量对象存储套餐', type: '对象存储', contexts: ['objects:prod', ...services], scope: '项目可选套餐', eligibility: 'requestable', source: '平台开放申请', value: '100 GiB · 单对象 5 GiB', effect: '先获得套餐使用权，再显式选择用于空间；申请套餐不等于已经创建空间。' },
  { id: 'production-db', name: '生产 PostgreSQL 访问', type: '数据库', contexts: ['db:production', ...services, 'migration'], scope: '生产环境；双槽共享', eligibility: 'used', source: '自动供给', value: '共享实例 · 未单列容量配额', effect: '生产槽按声明注入连接。开发与业务任务不由此获得生产数据访问权。' },
  { id: 'development-db', name: '开发 PostgreSQL 访问', type: '数据库', contexts: ['db:development', 'dev-work'], scope: '开发环境', eligibility: 'used', source: '自动供给', value: '独立于生产数据库', effect: '仅展示已配置的开发绑定。' },
  { id: 'dev-pvc', name: '开发工作卷', type: '工作存储', contexts: ['dev-volume', 'dev-work', 'dev-agents'], scope: '工作区 dev-work', eligibility: 'used', source: '自动供给', value: '10 GiB · 文件用量未观测', effect: '当前档位随工作区创建。此附件不提供仓内尚无合同的在线 PVC 扩容操作。' },
  { id: 'business-pvc', name: '任务工作卷', type: '工作存储', contexts: ['business-volume', 'business-work', 'business-agents'], scope: '任务 business-work', eligibility: 'used', source: '自动供给', value: '10 GiB · 文件用量未观测', effect: '仅所属任务及明确挂载的执行共享，不跨任务合并访问权。' },
  { id: 'api-read', name: 'GET /customers · 查询客户', type: '平台 API', contexts: ['apis', ...services], scope: '项目 API 授权', eligibility: 'used', source: '平台默认', value: '只读 · 已声明调用', effect: '授权与发布声明共同决定可调用范围。' },
  { id: 'api-orders', name: 'GET /orders · 查询订单', type: '平台 API', contexts: ['apis', ...services], scope: '项目 API 授权', eligibility: 'available', source: '项目分配', value: '只读 · 尚未声明调用', effect: '已获权限不代表已有调用连线；完成发布声明后才展示部署依赖。' },
  { id: 'api-export', name: 'POST /reports · 生成报告', type: '平台 API', contexts: ['apis', ...services], scope: '项目 API 授权', eligibility: 'requestable', source: '平台开放申请', value: '按项目限流', effect: '批准后获得权限；当前部署不自动添加接口调用。' },
  { id: 'event-orders', name: 'order.updated · 订单更新', type: '事件订阅', contexts: ['events', 'service:prod'], scope: '正式槽订阅', eligibility: 'used', source: '发布声明', value: '推送至正式服务', effect: '仅正式版本有此订阅声明；待验证槽没有这条推送关系。' },
  { id: 'gateway-rate', name: '入口请求速率', type: '网关额度', contexts: ['route:prod', 'route:preview'], scope: 'project:knowledge · 共享限流', eligibility: 'used', source: '平台默认', value: '100 次/秒', limit: 100, unit: '次/秒', adjustable: true, effect: '项目入口共享此额度；管理员调整后等待网关应用回执。' },
  { id: 'dev-preview', name: '开发预览路由', type: '访问入口', contexts: ['route:dev', 'dev-work'], scope: '开发会话 · 仅项目成员', eligibility: 'used', source: '自动供给', value: '绑定当前开发工作区', effect: '随开发会话生命周期供给和释放；保留项目身份验证。' },
  { id: 'mcp-default', name: '平台能力 MCP', type: '平台工具', contexts: ['mcp', 'dev-work'], scope: '开发会话身份', eligibility: 'used', source: '自动供给', value: '按当前会话权限调用', effect: '可用工具以会话身份和已有授权为准。' },
  { id: 'namespace-cpu', name: 'CPU 请求总额', type: '命名空间额度', contexts: ['namespace'], scope: 'namespace:cs-knowledge', eligibility: 'used', source: '项目分配', value: '8 核', used: 6.5, limit: 8, unit: '核', adjustable: true, effect: '作用于命名空间内所有工作负载。下调不终止已有实例，可能阻止新的资源调度。' },
  { id: 'namespace-memory', name: '内存请求总额', type: '命名空间额度', contexts: ['namespace'], scope: 'namespace:cs-knowledge', eligibility: 'used', source: '项目分配', value: '16 GiB', used: 13, limit: 16, unit: 'GiB', adjustable: true, effect: '按 requests 统计，不代表实时内存使用率；等待 ResourceQuota 观测确认生效。' },
  { id: 'namespace-pods', name: 'Pod 数量上限', type: '命名空间额度', contexts: ['namespace'], scope: 'namespace:cs-knowledge', eligibility: 'used', source: '项目分配', value: '30 个', used: 10, limit: 30, unit: '个', adjustable: true, effect: '覆盖全部部署与执行域的 Pod。' },
  { id: 'namespace-pvcs', name: 'PVC 数量上限', type: '命名空间额度', contexts: ['namespace'], scope: 'namespace:cs-knowledge', eligibility: 'used', source: '项目分配', value: '20 个', used: 2, limit: 20, unit: '个', adjustable: true, effect: '按 PVC 对象计数，与 PVC 容量和文件用量分别展示。' },
  { id: 'execution-quota', name: '项目执行并发', type: '项目额度', contexts: ['project', 'dev-work', 'dev-agents', 'business-work', 'business-agents'], scope: 'project:knowledge · 执行共享', eligibility: 'used', source: '平台默认', value: '8 个', used: 6, limit: 8, unit: '个', adjustable: true, effect: '开发工作区、业务工作区与 Agent 共用。服务槽不占此额度；下调不结束当前任务。' },
  { id: 'repository', name: '项目仓库 · knowledge', type: '代码与交付', contexts: ['project', 'release', 'build'], scope: '项目', eligibility: 'used', source: '自动供给', value: 'main · v2.5.0', effect: '代码与构建来源；仓库不属于 namespace 物理边界。' },
  { id: 'observability', name: '日志、指标与调用链', type: '公共能力', contexts: ['project'], scope: '项目', eligibility: 'used', source: '自动供给', value: '已启用', effect: '在运行与诊断查看对应部署与任务；不为每类日志增加一个拓扑节点。' },
  { id: 'config', name: '环境配置与密钥声明', type: '公共能力', contexts: ['project'], scope: '开发／生产分别管理', eligibility: 'used', source: '项目配置', value: '6 个键 · 不显示密钥值', effect: '使用环境和发布引用定位，实际 Secret 子对象仍保留原归属。' },
];
export const INITIAL_CHANGES: Change[] = [
  { id: 'REQ-1042', target: 'service-large', from: '未授权', to: '4 核 / 8 GiB', reason: '正式服务后续版本增加文档处理，需要更大的单副本规格。', status: 'pending', source: 'owner' },
  { id: 'REQ-1043', target: 'namespace-cpu', from: '8 核', to: '12 核', reason: '为后续发布与业务任务预留并发容量。', status: 'pending', source: 'owner' },
];
