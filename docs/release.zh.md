# 发布清单与双渠道流程

目标：GitHub 固定发布标签和 npm 精确版本均可安装。当前版本 **0.4.10**，宿主要求 **DSH 0.2.0+**。

## 对照社区指南

参照 [deepseek-plugin.org 发布教程](https://deepseek-plugin.org/zh/learn/publish-plugins)。该站是社区非官方目录，教程标注适用于 DSH **0.1.1-rc.2**；具体 manifest 和命令以本项目所参考的 DSH 运行时契约为准。

| 指南项目 | 本项目做法 / 验收点 |
| --- | --- |
| bundle 声明完整 | `package.json` 的 name/version/exports、`dsh.bundle.patch` 及根目录 `cordis.patch.yml` 完整。当前宿主不要求额外虚构一个含 name/version/entry 的 `dsh.bundle` 文件。 |
| 安装自检 | 对最终 GitHub 标签和 npm 精确版本，在同版本 DSH 的独立验证 profile 中安装并核实加载；静态检查不能冒充实际安装。 |
| README 开头三句话 | 插件名、用途和 npm/GitHub 安装命令均在中英文 README 开头。 |
| dshTarget / 版本声明 | 两份 README 明确 `Compatible with: dsh 0.2.0+`；manifest 的 `engines.dsh` 和 DSH peers 均使用 `>=0.2.0`。 |
| License | 根目录 MIT LICENSE，manifest SPDX 为 MIT；NOTICE 保留第三方来源及署名。 |
| GitHub topic | 仓库添加 `dsh-plugin`，可附带 `deepseek-harness`、`auto-review`。 |

包大小约百 KB，以最终归档为准。源码、客户端和文档均可公开；本机测试依赖、日志、环境文件与 profile 不进入版本控制和发布包。

## 准备发布包

发布前在项目根目录执行：

```text
node scripts/build.mjs
node --import ./test/runtime-loader.mjs --test --test-isolation=none "test/*.test.mjs"
python -B test/extract-runtime.test.py
node scripts/check-package.mjs
npm run pack:release
python scripts/package-deliverables.py
git diff --check
```

首次测试依赖准备见[开发说明](development.zh.md)。Windows PowerShell 若阻止 `npm.ps1`，使用 `npm.cmd`，无需修改系统执行策略。沙箱内 npm 缓存不可写时，可显式设置工作区缓存：`npm.cmd --cache ./tmp/npm-cache run pack:release`。

`pack:release` 显式构建、检查资源后执行 npm pack。客户端 `lib/client.js` 随 Git 跟踪，发布标签、源码归档与 npm TGZ 都带构建产物。消费者安装不执行 install/postinstall/prepare/prepack 生命周期脚本。不得依赖 Git 安装时批准任意构建脚本来补丢失的客户端。

检查实际 TGZ 的所有 exports、双语 locale 和 meta.detail 文档、内部 JS 相对导入、patch、icon、LICENSE/NOTICE；Markdown 相对链接不能断开。不包含 tmp、runtime-test、.env、.npmrc、运行日志、会话、缓存、私人目录或 Git 数据。发布检查脚本也检查同步构建和禁止的生命周期脚本。

## 推送前隐私检查

1. 扫描最终跟踪文件、待提交文件与 **origin/main..HEAD 的每个新增提交/blob**。只改 HEAD 不能清除更早未推送提交里的敏感信息。
2. 检查 API key、GitHub/npm token、私钥、带凭据 URL、私人邮箱、本机用户名和目录、真实会话 ID、私有模型/供应商配置。合法许可证署名和有意公开的仓库身份应保留。
3. 使用账户 GitHub noreply 邮箱提交；只对尚未公开历史作脱敏，并先保留本地私有备份。禁止把备份 ref、tmp 扫描输出或原始日志推送到远端。
4. 已公开初始历史里的联系方式不因后续修复消失；如需撤回，维护者须另行决定公开历史重写及协作者影响，不执行未经授权的 force push。
5. 最后检查实际 TGZ/ZIP 和发布附件。扫描器只能发现其规则覆盖的线索，不能证明绝对没有秘密。发现真实有效凭据时先停止发布并处理撤销，不将原值写入报告。

## GitHub 安装渠道

仓库：[NekoErwin/dsh-auto-review-desktop](https://github.com/NekoErwin/dsh-auto-review-desktop)。

1. 提交已验证且脱敏的源码、文档与同步 `lib/client.js`。
2. 核对远端主分支未出现其他更新，正常 fast-forward 推送 main；不覆盖已有远端提交。
3. 创建不可变版本标签 `v0.4.10` 并推送。禁止把可变 main 当作用户长期安装的精确发行来源。
4. 创建对应 GitHub Release，附最终 TGZ、源码 ZIP、校验和以及用户可读版本说明。附件不能包含本机绝对路径或本机验证会话记录。
5. 匿名读取该 tag 下的 manifest、客户端、locale 和 patch，确认公开下载成功，再在独立 DSH profile 安装：

```text
dsh plugin add github:NekoErwin/dsh-auto-review-desktop#v0.4.10
dsh plugin ls
```

CLI 不在 PATH 时可以使用图形界面的插件安装入口填写相同 GitHub spec。不要为 smoke 测试覆盖日常 profile 或正在工作的增强审查实例。

## npm 安装渠道

1. 在本机终端执行 `npm login --registry=https://registry.npmjs.org/` 完成网页认证。不要向对话发送 token、密码或验证码，不把 `.npmrc` 加入仓库。
2. `npm whoami` 核实登录。`npm view dsh-auto-review-desktop` 的 404 只说明查询不到公共包，并不绝对保证名称可注册。
3. 对最终审查过的 TGZ 执行：

```text
npm publish deliverables/dsh-auto-review-desktop-0.4.10.tgz --access public --registry=https://registry.npmjs.org/
```

如本地已存在更早同版本的试制包，先核对实际 TGZ 与源代码/校验和，选择本次重新生成的包；**不得误发旧产物**。npm 的同名同版本一旦发布不可覆盖。

4. npm 可能要求账户 2FA 或浏览器确认。维护者在本机完成这些步骤，不在聊天中传输 OTP。若没有可安全完成的认证通道，只保留已验证包和准确命令，发布状态标为待认证。
5. 从公共 registry 核对版本、dist.integrity、发布时间，并下载实际公开 TGZ 重验文件，再安装：

```text
dsh plugin add dsh-auto-review-desktop@0.4.10
dsh plugin ls
```

推荐直接使用包名 spec；不使用 npm alias，使 DSH 的原生版本更新发现能够正常识别。GitHub 与 npm 两种来源在同一 profile 任选其一。

## 目录收录与 DSH 市场索引

GitHub/npm 发布与目录收录是独立步骤。添加 `dsh-plugin` topic 后按社区规则申请 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 收录；是否自动抓取、何时更新以维护者为准。没有确认目录页面前不能宣称已收录。

DSH 自定义市场读取用户配置的 HTTP(S) JSON 索引源。格式 1 每版本可选择 npm 精确版本或 HTTPS Git 仓库完整 40 位 commit SHA。发布后可生成条目：

```text
node scripts/create-market-index.mjs --source npm --published-at <registry真实Unix秒> --out deliverables/market-index.json
node scripts/create-market-index.mjs --source git --commit <公开tag对应40位SHA> --published-at <真实Unix秒> --out deliverables/market-index-git.json
```

脚本只生成当前版本的单插件索引，不联网发布。更新已有索引时合并条目并保留旧版本，不能覆盖其他插件。提交到目标索引源或托管最终 HTTPS JSON URL；DSH 索引服务拒绝重定向。不要把 GitHub 发布 ref 和自定义索引中要求完整 commit SHA 的规则混淆。

## 版本说明与验证边界

0.4.10 包含跨平台开发脚本、Windows/Linux/macOS 路径及 Bash 路由契约测试、已显示通知的语言切换修复、双语用户文档/详情以及 GitHub/npm 发布准备。

Windows 回归及三平台服务契约已验证；真实 Linux/macOS OS 沙箱、真实界面切语言和公开渠道独立 profile 安装需分别记录。缺少某项时明确标注，不能用 mock 或归档检查替代。用户详情应持续披露审查会消耗额外 tokens，历史包含完整参数/模型理由且不自动轮转，卸载不保证删除历史。
