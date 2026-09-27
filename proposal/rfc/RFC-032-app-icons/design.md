# RFC-032 Design

## 分层

展示配置仍归 modules/project。图标来源值与引用是 domain，权限／revision／保存事务在 application，图片解码在 adapters/media，持久化在 adapters/persistence，HTTP 二进制接收／输出在 http。客户端契约归 packages/contracts 与 packages/api-client；可复用纯展示 AppIcon 组件归 console shared/ui/icons，编辑状态与上传 UI 归 features/projects，市场调用 shared 组件。不得从 capabilities import projects 内部。

实施前验证适用于现有 Bun/部署镜像的图片解码依赖；优先成熟解码库，解码器作为 port 注入。不以浏览器预处理当服务端验证。新依赖与 native 构建必须在实际镜像构建验收。

## 来源模型

保留原 icon 枚举作为 fallback；新增 iconSource 判别联合：app（默认）、url {url}、upload {revision}。旧数据读为 app；旧客户端省略新字段时保留当前值，不能悄悄覆盖已上传图标。显式选择 app 即恢复自动来源。

项目展示 DTO 与市场 DTO 增加可选来源描述；upload 只返回同源受保护图片 URL，绝不把完整 base64 放进每页市场列表。市场只根据现有经过权限裁定的入口构造约定地址，不能因为知道 projectId 去探测隐藏应用域名。

来源解析顺序为手动源（若有）→应用约定源（若可访问）→内置符号。绝对 URL 用 URL 解析验证；根相对 URL 只允许单斜杠路径，拒绝 //host、用户凭据、非 HTTP(S) 协议。URL 模式由浏览器 img 读取，不新增后端 URL 抓取／代理，因此不产生服务端内网探测入口。远程资源失败处理 onError 和每候选3秒展示超时；不轮询图标，不跟踪响应 HTML；source key 改变才重试。

## 上传与事务

新增项目展示图标上传端点，受 owner/admin 与 expectedRevision 控制；原始图片二进制大小在 HTTP 层及解码层均限制。解码端限制像素／尺寸，规范化到128px以内、去元数据、单帧输出 PNG/WebP，存入 project 归属的小型图标记录（规范化字节以 base64 text 存储，最多64KiB解码后；项目外键与唯一主键）。与 app_listing 的来源、revision 更新同一事务，避免未引用的长期临时文件。

上传端点提交语义是“保存本次展示设置”：同次携带描述、fallback、expectedRevision 与图片；统一表单保存按钮才提交，选文件只本地预览，关闭保留草稿；不要选文件即自动更新线上图标。URL／app 来源继续走扩展后的 setAppPresentation，删除旧图标记录与来源切换同事务。

新增同源读图端点，每次验证当前 actor 是否能看到该市场应用（复用 listing 可见性谓词，不以 project view 权限代替：市场用户可能没有开发权限）。响应固定正确 image MIME、nosniff、private/no-store；不对不可见项目泄露图标内容；不得设置 public CDN 缓存。查询 revision 用于前端 source key，不是绕过授权的永久地址。图标无历史业务含义，不保留无限上传历史。

## 失败与兼容

上传失败不覆盖旧来源；409 保留全部草稿（包括待上传文件），支持既有 rebase 流程。URL模式的保存不以服务端能否读取 URL 为前置条件，编辑预览提示失败但保留可修正输入。业务约定 URL 按业务部署缓存策略更新，平台不偷偷修改业务部署。

应用约定资源必须由应用提供，工作台不修改业务仓库模板或真实部署来满足预览。本 RFC 不改变网关授权；若未来要允许仅图标匿名访问，另立明确权限规则。

## 验证与边界

contracts 新模型的兼容、strict 与URL校验；module 的真实数据库原子替换、权限、并发revision；HTTP 上传成功必须实际改变读图输出、坏格式/超限/越权拒绝；图片解码适配器用真实文件；console 覆盖有限fallback、草稿、来源切换；浏览器验证图片尺寸与加载请求顺序。新增迁移锁／必要业务契约锁按测试规则处理。批准后再确定路由命名与落库文件序号，防止撞并行迁移。
