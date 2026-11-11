# 开发与版本管理

本目录是 Git 项目根目录，默认分支为 `main`。远程仓库为 `https://github.com/NekoErwin/dsh-auto-review-desktop.git`。仅在用户要求时推送。

## 目录

- `src/`：Host 审查门、双权限模式路由、原生工具兼容检查和 Desktop 设置。
- `vendor/`：保留许可证及来源记录的官方审查模块。
- `test/`：模型审查、双模式、原生工具/审批/沙箱、客户端和 Loader 生命周期测试。
- `scripts/`：构建、打包及同版本测试运行时提取。
- `lib/`：生成的原生客户端 bundle，被 Git 忽略，但安装包必须包含。
- `deliverables/`：安装包、源码压缩包和本机验证记录，被 Git 忽略。
- `runtime-test/`：同版本 Desktop 测试依赖，被 Git 忽略。
- `tmp/`：调查资料、一次性探测工具和可删除的隔离测试目录，被 Git 忽略。

## 构建与测试

在项目根执行（Node 24.21 或兼容版本）：

```powershell
node scripts/build.mjs
node --import ./test/runtime-loader.mjs --test --test-isolation=none 'test/*.test.mjs'
```

构建不安装依赖，浏览器使用宿主 React。测试不发真实模型请求，默认加载 `runtime-test/dsh/node_modules` 中的 Desktop 0.2.2-rc.1。首次准备缓存：

```powershell
python scripts/extract-test-runtime.py
```

提取脚本默认读取本机 Desktop 安装 ASAR，也可设置 `DSH_TEST_RUNTIME` 为包含同版本 `node_modules` 的 dsh 运行时目录。

工作区测试使用真实原生工具定义和原生审批服务；真实文件测试在项目 `tmp/` 下生成独立目录，验证工作区外写入拒绝、仅一次模型提权写入以及随后仍然拒绝。不要把模拟“工作区外目标”放进平台临时目录，因为原生沙箱本来允许其临时根。路径解析竞态、取消、授权变更、`never`、PTC token 和审批审计均需保留回归覆盖。

`native-subagents` 捕获同版本真实 `tool-subagent`、spawn/fork provider 和控制工具定义及执行闭包，覆盖可选模型字段省略、显式父路由和原生预检拒绝；工作区协调测试将原生创建闭包接到增强继承钩子，确认创建免额外审批而子代理未知动作仍需审批。这是组合接缝测试，不是完整真实模型 AgentLoop。检查创建 cwd 保持父工作区范围、外部/不兼容工具回退、目标消息关系变化和动态上下文中的实际父模型值。不要自动纳入用户实测留下的根目录探针文件。

`native-compatibility` 固定同版本完整 ToolSchema 的 SHA-256，并固定每个 agent 的首次兼容定义身份。它用于保守兼容回退，不认证 Host 插件实现。升级宿主、原生工具配置或 Schema 时，先验证真实执行/沙箱链路再更新兼容表；不要只更新 hash 以绕过回退。

## 打包和安装

```powershell
node scripts/build.mjs
python scripts/package-deliverables.py
```

当前源码版本 `0.4.3`。输出在 `deliverables/`，只包含显式列出的源码和生成物，不包含运行时缓存、临时文件或 Git 数据。正式版本安装包已有时不覆盖，同版本重建输出 `-local.tgz`。正式发布先递增版本。

源码 ZIP 包含测试与开发说明；安装 TGZ 包含原生客户端构建。新检出先构建再打包。安装必须使用宿主插件管理器，不能手工改 profile composition 或运行 profile 包管理器。管理器返回 `application: applied` 才表示本次变更已经应用；需要刷新现有 Desktop 页面读取新客户端，不要启动替代服务器冒充验证。

安装后核实版本、已启用 entry、Config 默认 `workspaceEscalation: ask`、`workspaceReads: allow`、`preciseDeletion: true`、`denialPolicy: deny` 和 `subagentApproval: inherit`，并检查已有 `auto-review-desktop` 完全访问身份仍保留。子代理测试应使用真实宿主 capture/append、spawn/fork provider、AgentRegistry 和 pinInitialPermission，区分组合接缝测试与完整 AgentLoop/真实模型端到端。UI 汇总必须调用原生 pending 对象，不新增代理可调用的批准 RPC；覆盖同子代理并发、原生取消、其他页面答复及插件重载。界面截图/真实页面未取得时明确记录验证限制，不把 VM 组件测试称为实际渲染验证。

## 提交

提交前运行完整测试、构建以及 `git diff --check`。只提交项目源码、测试和说明；生成包、运行时缓存及本机 profile 不进入 Git。提交说明应覆盖两个权限标签和单次工作区提权行为。版本升级不自动授权 Git 推送。
