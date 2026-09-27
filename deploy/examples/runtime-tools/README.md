# pip、npm、脚本与二进制工具环境

在「平台管理 → 运行镜像 → 新增镜像」中选择「直接编写 Dockerfile」，粘贴本目录的 Dockerfile，并上传它引用的文件。上传后将路径改为 Dockerfile 中对应的相对路径，例如 `native/tool.c`、`node/package-lock.json`、`scripts/hello.sh`；需要直接执行的脚本勾选执行权限。无需创建业务或代码仓库，平台保存固定配方修订。

直接编写支持最多 32 个文件、解码后总量 512 KiB，Dockerfile 最多 256 KiB。大文件通过 Dockerfile 下载并校验摘要。点击「保存并开始构建」后，在该镜像的「构建与日志」查看进度，成功产物显示在「产物版本」。

也可以选择「从仓库构建」：将本目录复制到项目仓库，如 `runtime/tools/`。构建上下文选 `runtime/tools`，Dockerfile 选 `Dockerfile`，ref 选所需分支或提交。平台受理时固定提交，不读取开发容器的未提交文件。

同一份配方可分别构建任务和 Agent 镜像：

- 任务用途由平台注入任务底座。
- Agent 用途还需指定 `baseProfile.profileId` 与 `baseProfile.revision`，平台注入该档位的底座。镜像中的 Agent 程序与模型接入仍由算力档位负责。
- 平台提供 `CS_BASE_IMAGE`，不用也不能在自定义 buildArgs 里覆盖它。保留最终阶段的继承关系与 Runner 文件。

这个例子演示五类实际工具：Python 虚拟环境里的 PyYAML、项目独立目录里的 npm YAML 包（分别以 CJS 和 ESM 调用）、本地脚本，以及从 C 源码编译的动态链接二进制。Python 依赖固定在 requirements.txt，npm 使用已提交的 package-lock.json；按业务要求维护自己的版本锁。

将 `tools.json` 中的检查填入镜像修订的 `tools` 字段。平台在 worker UID 10001 下检查，避免只在 root 下安装成功、实际 Agent 无法读取。Python 使用 `/opt/business-tools/python/bin/python`，Node 脚本放在自身依赖目录内，不依赖工作卷中的 node_modules 或全局 NODE_PATH。

要预置下载的二进制，使用 `scripts/install-binary.sh`。例如在 Dockerfile 中添加 `ARG TOOL_URL`、`ARG TOOL_SHA256`，再执行：

```dockerfile
RUN /opt/business-tools/install-binary.sh "$TOOL_URL" "$TOOL_SHA256" /usr/local/bin/business-tool
```

脚本只接受 HTTPS，校验指定 SHA-256 后才安装。提供与目标架构及底座 libc 匹配的文件，并添加业务调用所需的动态库。不要把包仓库令牌写入 ARG、ENV、URL 或源码；从仓库构建时，私有包凭据通过平台配置引用与 BuildKit Secret mount 使用；直接编写首版只接受普通构建输入，暂不提供私有包凭据配置。

镜像构建成功后，对任务用途发起验证；用于 Agent 时再对相应档位修订发起 Agent 验证。通过后，分别配置开发任务与各 Agent 的默认／允许镜像，也可在启动表单单独选择。服务镜像需要包含完整服务程序，应使用服务自己的 Dockerfile，不使用这个 Runner 模板。

本目录是构建示例，不是自动注册的项目模板。自动化测试验证配方规则与下载校验；真实镜像构建和 worker 工具运行以 RFC-028 的 RI-03／RI-04 实机记录为准。
