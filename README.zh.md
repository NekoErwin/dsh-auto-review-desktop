# DSH Desktop 自动审查增强版

版本：0.1.3。适配当前 DSH Desktop 0.2.2-rc.1；不对其他版本自动授予兼容豁免。

这是基于官方 `@deepseek-ai/dsh-experimental-auto-review` 的本地扩展。保留官方审查策略、授权来源分层、原生/PTC 动作完整性检查和严格 JSON 判定协议；加入选取自 Codex 的工程机制及原生 Desktop 设置。并未复制 Codex 的整套审查代理或改变 DSH 风险策略。

## 使用界面

打开 Desktop 设置，选择“自动审查”。界面使用现有主题、中英文语言服务、设置存储及共享模型目录。

- 审查模型可跟随当前会话，也可从已经配置的 provider/模型分组列表中选择，支持筛选。无需另填 API key，也不会切换主模型。
- 推理强度默认“支持时使用 low”，也可使用模型默认值；固定审查模型时可以从其真实能力目录选择档位。模型消失、档位不支持或路由不完整时不会悄悄切回主模型。
- 设置为 profile 范围，保存后对后续审查生效。保存不把当前会话切换到 Auto；需要在会话权限菜单中选择 Auto。
- 设置保存使用原生配置镜像及 revision 校验。并发编辑发生冲突时保留草稿，要求重载，不覆盖别处更新。
- “审查用量”展示本次插件运行的审查尝试、模型判定、失败/取消、provider 实际报告的输入/输出/缓存 token，挂载读取一次，之后手动刷新。

## 选入的 Codex 机制

| 能力 | 此版本实现及边界 |
| --- | --- |
| 独立审查模型 | 使用 Desktop 现有目录，不新增账户体系；固定路由不可用时拒绝或转人工 |
| 能力感知的推理控制 | 优先 low；不支持时使用模型默认档位；显式档位必须被模型支持 |
| 截止时间与取消 | 包括模型准备、流读取和授权复检；provider 忽略取消时，超时后的允许结果仍然不能放行 |
| 审查完成后的有效性检查 | 重新检查动作、用户授权、工作目录、主请求路由和审查设置；失效结果拒绝 |
| 输入及成本保护 | 保留完整授权证据；超过字符上限不截断；输出 token 上限、每轮尝试上限、连续失败熔断 |
| 有限重试 | 默认不重试；可启用一次，只针对明确的传输/服务/限流错误；不重试拒绝或不合法判定 |
| 人工回退 | 默认错误拒绝；可设置为人工审批。never 仍最终拒绝；动作完整性或失效授权错误始终拒绝 |
| 用量及审计 | 用真实 usage 计量，不估算未报告的推理量；单独记录模型尝试与最终门控结果 |

Codex 还有本版暂未移植的能力：受限只读调查工具、复用审查会话及并发分支、Full/Delta 上下文游标与检查点恢复、与模型上下文窗口结合的完整 token 预算，以及部分版本的异步评分/策略路径。

本版审查器不提供调查工具，完整输入采用官方稳定消息前缀；缓存是否命中取决于 provider。输入保护是**字符上限**，不是 tokenizer，不等同 Codex 的模型窗口预算。不存在允许结果缓存、自动重试拒绝或静默压缩授权证据。

## 安全策略

官方协议只接受 low/medium + allow，或 medium/high + deny（可带非空 reason）。重复 JSON 键、多余字段、前后夹杂文字、high + allow、不完整流均失败。

审查门覆盖官方所覆盖的全部 Auto 动作及 PTC 内部调用，外层 run_code 只作为传输。工具执行前还保留其他下游权限检查。审查失败没有自动 allow 分支。

卸载或热替换本插件时先取消在途审查，并通过沙箱策略 API 将已加载 Auto 会话切回 workspace-write/ask；不依赖可能被重定义的 preset 名称。整个应用正常退出时保留会话持久配置。

**升级官方审查器时应先让已加载的 Auto 会话退出 Auto，再替换其入口。** 当前官方版本自己的热卸载回退会使用 full access；部署应使用随交付提供的临时迁移保护或在应用完全退出后安装并重启，避免这个旧版生命周期缺陷。

## 默认值与费用

| 设置 | 默认 | 可用范围 |
| --- | --- | --- |
| 模型 | 跟随会话 | 跟随或已配置模型 |
| 推理 | 支持时 low | low/默认/模型支持的具体档位 |
| 超时 | 60,000 ms | 1,000–180,000 ms |
| 输出上限 | 2,048 token | 256–16,384 |
| 输入上限 | 120,000 字符 | 4,000–1,000,000 |
| 每轮尝试 | 100 | 1–1,000，含失败及重试 |
| 重试 | 0 | 0 或 1 |
| 错误处理 | 拒绝 | 拒绝或人工审批 |

每次送审都会增加一次模型请求；选择较便宜模型及低推理可能降低支出，但没有同任务实测数据，不能承诺比例。失败请求也可能收费；provider 不报告 usage 或忽略取消时，界面无法还原最终账单。usageReported/attempts 用于显示统计覆盖度。推理常已计入 output，不应再次相加。审查次数是尝试计数，模型 allow/deny 是审查判定，实际动作还要通过下游门控。

连续三次失败会在本轮停止新增模型尝试；新的 turn 重置预算。它不是永久的账户熔断。

## 安装与回退

交付的 `.tgz` 是已构建的 npm 插件包，无安装脚本，无新增浏览器 React 副本。插件管理器的“本地包”安装目标可指向该包，启用后刷新当前 Desktop 页面。

本 bundle 禁用 `auto-review` 官方行，并插入独立的 `auto-review-desktop` 入口及同名设置 namespace。Loader 的 patch.name 是匹配条件，不能用于替换模块名；因此必须使用禁用+插入方式。官方 bundle 必须在其之前提供原行，这与当前 desktop profile 一致。同一时刻只注册一个 Auto gate。

禁用或移除本 bundle 后，底层官方行恢复；本插件卸载时会把已加载的 Auto 会话降为 workspace-write/ask，用户需要重新选择 Auto。不会改变 provider 凭据、主模型配置或写入核心会话的新事件类型。

## 审计和状态

`/auto-review-status` 显示当前配置、当前轮预算和本次运行统计。设置页只读状态 RPC 要求认证且 `peer.principal.kind === owner`，只返回聚合值，不暴露其他会话的明细。

审计位于当前 profile 的 `.plugin-data/dsh-auto-review-desktop/`，每进程分别写入 `reviews.<pid>.jsonl`；单文件约 2 MiB 轮转为同进程 previous 文件。不同 profile、不同进程不共写同一文件；历史进程文件可在需要时归档。仅保存模型、工具名、关联调用 id、时间、结果、错误代码和用量，不保存参数、会话正文、模型理由或原始 provider 错误。审计写入不可用会在状态中显示，不放宽审查决策。

模型尝试记录 scope=review-attempt，最终门控 scope=gate-outcome。输入超限、预算耗尽及动作完整性等调用前阻断会记录 gate-outcome，不伪造一次付费请求。

## 验证与源码依据

使用从本机 Desktop ASAR 提取的同版本真实 Cordis、Schema、LLM BlockAssembler 和官方快照/解析器进行离线验证，所有 provider 请求由测试流替代，没有消耗模型 API token。原桌面激活与界面验证记录归档在本机 tmp/ 及 deliverables/ 中，不能用离线测试替代实际桌面验证。

项目内测试入口为 `test/runtime-loader.mjs`，默认指向本项目的 `runtime-test/dsh/node_modules`；也可设置 `DSH_TEST_RUNTIME` 指向其他包含 node_modules 的同版本 dsh 运行时目录。构建入口 `scripts/build.mjs` 检查原生客户端 bundle 语法并复制到 lib/client.js，无需联网构建。

官方模块保留 MIT 许可证；vendor/official.js 仅改变导出列表，不调用其原 apply。上游源码 SHA-256 见 NOTICE.md。

Codex 参考固定提交 `fe8e540a80f17716bf2a3007f06e8a602192c704`：

- [完成后的授权有效性检查与失败处理](https://github.com/openai/codex/blob/fe8e540a80f17716bf2a3007f06e8a602192c704/codex-rs/ext/guardian-reviewer/src/completion.rs)
- [模型选择与 low 推理](https://github.com/openai/codex/blob/fe8e540a80f17716bf2a3007f06e8a602192c704/codex-rs/core/src/guardian/reviewer_config.rs)
- [会话复用与上下文](https://github.com/openai/codex/blob/fe8e540a80f17716bf2a3007f06e8a602192c704/codex-rs/core/src/guardian/review_session.rs)
- [请求输入预算](https://github.com/openai/codex/blob/fe8e540a80f17716bf2a3007f06e8a602192c704/codex-rs/core/src/guardian/request_budget.rs)

上述公开实现中还包括尚在发展的路径；此扩展只移植可独立验证的机制，不声称与 Codex 线上服务具有相同保障或费用。


## 项目维护

源码与测试已整理到项目根目录。构建、测试、打包和资料目录说明见 [DEVELOPMENT.zh.md](DEVELOPMENT.zh.md)。
