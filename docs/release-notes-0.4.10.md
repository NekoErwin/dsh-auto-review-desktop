# 0.4.10

Compatible with **DSH 0.2.0+**.

- Two independent permission choices: Auto review (Workspace) and Auto review (Full access).
- Configurable reviewer model, limits, failure/denial policies and child-agent human approval.
- Native child-agent review inheritance, individual approvals, persistent review history and per-session usage.
- English/Chinese user guides and UI labels that follow DSH, including notices already on screen.
- Danger zone cleanup previews this profile's plugin data, requires `DELETE`, stops review and persistence, and clears history/statistics before removal.
- Cross-platform runtime preparation and Windows/Linux/macOS path and Bash routing contract coverage.
- GitHub tags and npm packages include the prebuilt client; no install/prepare/prepack lifecycle scripts.

**Install one source:**

```sh
dsh plugin add dsh-auto-review-desktop@0.4.10
# or
dsh plugin add github:NekoErwin/dsh-auto-review-desktop#v0.4.10
```

Local installation: download the TGZ and use DSH's plugin manager. Apply the update, restart if requested and refresh the existing page. Stop enhanced sessions before replacing the plugin; reselect the desired permission mode afterwards if needed.

**Validation:** 229 Node regression tests pass locally. Windows sandbox behavior and simulated cross-platform path/routing contracts are covered. Actual Linux/macOS OS sandbox execution and interactive browser language switching have not been verified. CI packaging checks run separately on Windows, Linux and macOS; those are not OS sandbox tests.

**Data and cost:** reviews use additional model tokens. Local history includes complete tool arguments and model denial reasons and currently has no automatic rotation. Removing the plugin should not be assumed to erase history. Workspace operations exempt from model review also skip precise deletion review; this is model policy, not an OS deletion block.

---

本版支持工作区/完全访问两种增强审查模式、独立审查模型、子代理继承和逐项人工审批、持久审查记录及会话用量。中英文用户说明和界面跟随 DSH 语言，修复已显示提示的语言切换。

设置中新增“危险区域 → 清理本地数据”：先预览当前 profile 本插件目录，输入 `DELETE` 确认，停止审查和持久化后删除审查历史及统计日志；保留配置、凭据、会话和其他插件数据。操作不可撤销，继续使用前需重载插件。

GitHub 标签与 npm 包均带客户端构建，无安装/prepare/prepack 脚本。更新前停止增强会话，应用后按提示重启并刷新页面，按需重新选择增强模式。

本机 229 项 Node 回归通过；尚未在真实 Linux/macOS 系统验收 OS 沙箱或进行真实浏览器语言切换验收。审查会消耗额外 token；本地历史包含完整参数和模型拒绝理由，不自动轮转，卸载不保证擦除历史。
