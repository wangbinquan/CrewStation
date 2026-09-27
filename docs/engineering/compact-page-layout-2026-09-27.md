# 页面标题与集群清单有效空间验收

作者要求：检查 Pod、存储与配置及其他类似页面，解决表格与滚动条操作空间不足；全站页面标题区缩到最小。

## 实机原因与修复

- 1440×900 原部署：Pod 表格滚动区只有 145px，存储与配置只有 113px。七行范围汇总占约 273px；页头另占约 59px。
- 公共 `PageHeader` 改为紧凑标题与同行说明，保留全部文字、必要操作和元数据，窄屏换行；主内容上下内边距收紧，吸顶偏移同步修改。
- 集群范围汇总在清单标题右侧保留范围和 Pod/PVC 数量，原生 details 默认收起、键盘可展开；全部指标、部分覆盖与过期状态保留。公共汇总也改为横向换行，管理总览的展开明细同步受益。
- 去掉筛选卡的重复标题，保留具名可访问分组；桌面筛选尽量一行，窄屏两列。表格填满剩余高度，无分页时不渲染空操作行。工作负载、网络、命名空间、待回收卷共用紧凑清单样式。

## 部署前验证

使用作者允许的现有 dev-admin，在独立验收页面正常 OIDC 登录。仅在该页面替换 `/assets/*` 为本地工作台构建，接口仍读取真实集群；没有部署此修改，也没有操作集群资源。

最终 1440×900，明暗主题结果相同：

| 页面 | 修改前表格高度 | 修改后表格高度 | 修改后占窗口比例 |
| --- | ---: | ---: | ---: |
| Pod | 145px | 586px | 65.1% |
| 存储与配置 | 113px | 546px | 60.7% |

- 高度回归覆盖中文默认清单的 1440×900、1280×800、1366×768、1280×720：表格至少半屏、底部可点击、表头吸顶、整页不溢出。
- 1280×720 核对汇总 Space 展开/收起和资源详情；320/390px 核对中英文换行及无横向溢出。展开汇总会占用额外高度，这时仍能操作表格。
- 浏览器巡检 37 个不同路由/页签，覆盖平台管理、集群九类清单、项目目录/概览、发布、运行诊断与设置；桌面标题大多 20–32px，带项目元信息约 48px。普通自然高度列表、闭合详情内的表格和空列表不误判成被压缩。
- 并行开发中的业务执行恢复页存在尚未部署接口的读取失败；只核对其公共标题，没有把这次布局测试写成功能验收。
- `check:static` 通过；工作台整层 934 pass / 0 fail / 6432 assertions；生产构建通过。
- `compactPageLayout.test.ts` 与 `clusterLayout.test.ts` 真实浏览器合计 11 pass / 0 fail / 202 assertions。新增高度用例先在原部署得到 145/113px 的失败，再在本地构建通过。
- 旧用例以「切换条前至少滚动 100px」间接锁死大页头，现改为真实滚动大于零，并继续验证切页不跳动。

上述为部署前候选内容验证；后续提交、CI 与实际部署结果见下节。共享工作树中的其他任务输出始终保留。

截图：`/tmp/cs-compact-light-pods.png`、`/tmp/cs-compact-dark-storage.png`；日志：`/tmp/cs-compact-{static,console,browser-tests}.log`。验收页面已关闭。


## 提交与本机部署

- 布局代码提交 `932bfd1e9994ae02e24c23061e62e3df8183b7ff`（13 个精确路径），已推送；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/36314029740) 六项作业成功。
- 最终工作台镜像从后继 `3af3c568cdd9ededb0a3bc56034f1cb1c4760d7d` 的 `git archive` 构建，同时保留镜像编辑 revision 修复；未混入共享树在制内容。[最终部署 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/36314080207) 六项作业全部成功。
- 与并行平台发布串行交接后，仅更新 `docker-desktop / crewstation-system / deployment/console`，实际镜像 `cs-console:compact-3af3c568`，imageID `sha256:47adaebfb5ff3b3153b0da279e6df1d3756ac30f0c3cd9435101b1864f6a70ac`，Ready/Available 为 1，重启 0。
- 部署后以获准的 dev-admin 正常 OIDC 登录，直接加载实际服务资产（无本地替换）：`index-BrIyZiW7.js` / `index-L1rx_h1t.css`。Pod 表格 586px、存储与配置 546px、标题均 20px，与候选验证一致。
- 实际部署再次运行两个布局 E2E 文件：**11 pass / 0 fail / 202 assertions**，四种桌面窗口均至少半屏可操作，窄屏中英文、汇总键盘展开与详情布局通过；独立验收页已关闭。
- 部署后证据：`/tmp/cs-compact-deployed-browser.log`、`/tmp/cs-compact-deployed-measurements.json`、`/tmp/cs-compact-deployed-{pods,storage}.png`、`/tmp/cs-compact-after-{deployment,pods}.json`。
