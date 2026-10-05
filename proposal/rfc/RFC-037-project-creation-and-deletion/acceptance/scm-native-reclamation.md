# 原 GitLab 封写与留存文件实际清理

本批实现可执行的原生封写及描述符清理，继续 RFC-037 全资源永久删除；不把两个底层执行回执当作完整删除成功。

## 原生封写

`packages/gitlab-client/native/fence/runner.rb` 在固定原 GitLab 19.2.4 的 Rails runner 中执行。host 配置绑定原 Docker ID、imageID、StartedAt、PID namespace 和既有服务管理员，HTTP 调用者不能提交账号或脚本。执行前核对原项目 ID／路径／创建身份／存储位置、完整原令牌／机器人／成员出生及独占归属；项目、机器人及令牌锁定后再次检查，再调用原 `Projects::DestroyService#mark_deletion_in_progress`、`PersonalAccessToken#revoke!`、`Users::BlockService` 及 `Ci::AbortPipelinesService`。不排队异步销毁项目、不删除仓库文件。共享账号、身份缺失和替换均在首次副作用前拒绝。

封写回执保存真实 pending-delete／deletion-in-progress、令牌和账号状态、可取消流水线数量及写权限。原实例实际管理员仍有安全文件／令牌接口权限，因此归档或 pending-delete ACK 不能单独认定全部写入及消费关闭。三个完整清理标志保持 false；正式 owner 必须组合全部平台原回调退出、原生消费者来源、父记录销毁及完整留存清理。

私有 handler 在变更前强制核验删除许可，前后核对原实例；SDK 冻结请求、校验完整身份、原请求／事实摘要、时效和 namespace。请求与响应最多 8 MiB，超时 90 秒，固定 Ruby 内部 80 秒；拒绝重定向、未知字段和非法 UTF-8。未绑定真实许可核验器不得开放该 handler。

## 留存文件实际清理

`packages/gitlab-client/native/storage/remover.rb` 在原 embedded Ruby 中清理完整原清单，不加载 Rails，不读取业务字节。host 绑定七类原根目录，不能由请求替换。原清单及当前完整描述符盘点在任何删除前核对；同名替换、晚到或改变的文件、重叠范围、跨设备、符号链接、硬链接及根目录出生变化均拒绝。实际删除只使用已验证原目录的描述符相对路径；每个对象再次核对身份后 unlink／rmdir。父记录消失仍可操作已保留的位置；全部描述符关闭后独立重新读取这些位置，必须明确为空。中断后已缺失的原对象可重放，未删对象仍须保持原身份。

私有清理 handler 强制先核对原删除许可、再核对独立的写入／消费停止来源。仅私有 bearer 或请求中的布尔值不能授权删除。完整存储范围、Gitaly 改名留存目录、全部历史 prefix／外部引用仍由正式 SCM 物理 owner 绑定；这层只证明指定原位置的清理，不把路径缺失扩大成全 SCM 回收。

## 验证

- `/private/tmp/cs-rfc037-scm-fence-readonly-v1.json`：原 GitLab 383、令牌 513／549、机器人 541／577 的当前身份已通过实际 Fencer 的同一校验逻辑；前后原生修订均为 `1d3a759e61b64b01607333b136414d38a7de267a1c164fdc2fa1fb8a245fa634`，原项目没有封写或改变。
- `runner.test.rb`：10 组原执行逻辑检查，覆盖锁定后替换、项目出生／位置变化、共享成员、权限拒绝、真实服务调用顺序、重复封写及停止错误；standalone fixture 不加载 Rails、不打开原数据库。host Bun 用例运行它。
- `/private/tmp/cs-rfc037-scm-remover-ruby-v1.log`：原 Linux/aarch64 embedded Ruby 在独立临时目录中实际删除；12 组覆盖清理、重放、部分删除恢复、同名替换、改变／新增内容、硬链接、符号链接、原缺失位置变化、重叠及根替换。只清理由用例创建的目录，原项目／外项目均保留。CI 的 Linux host 用例运行同一 Ruby 文件；macOS host 验证 Ruby 语法，实际 Linux 行为以上述证据为准。
- 全 GitLab SDK 与 host 组合：68 pass、0 fail、467 断言、11 文件；结构、lint、后端及工作台类型全部通过。相关七个新增 TS 生产文件的执行行全部命中（214／214）；Ruby 行单独验证，不计入 TS 覆盖率。

当前生产基线为 `c9a4c71a05bbb04d4195157dd70ac92a768ec4a3`：六项精确 CI 成功、八组件 Ready、248 项迁移安装并核对，原项目／共享资源保持。创建弹窗已经上线。本批固定候选完整检查已通过：5888 pass／143环境skip／0 fail、223503断言、1170文件、2210.00秒（`/private/tmp/cs-rfc037-scm-mutations-full-check-v1.log`），所有19条候选指纹保持；源码／测试未改变，仅回填本文、STATE及计划。host专项类型已通过（v1临时配置缺少仓库typeRoots的失败记录保留，v2修正后通过），提交／推送状态继续回填；全删除依然需要 SCM 完整物理适配器、Garage、镜像发布、剩余 legacy／未启动兼容、全部生产装配和管理员二次确认实机回收，目标保持 active，入口和普通 producer OFF。
