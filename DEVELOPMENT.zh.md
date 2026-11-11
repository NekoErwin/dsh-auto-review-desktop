# 开发与版本管理

本目录是 Git 项目根目录，默认分支为 main。当前仅初始化并暂存文件，按用户选择尚未创建提交，也未配置远程仓库。

## 目录

- src/：插件后端和原生 Desktop 设置界面。
- vendor/：保留许可证及来源记录的官方审查模块，是运行所需项目源码。
- test/：审查行为、原生设置、Cordis 生命周期和 Loader patch 测试。
- scripts/：客户端构建、发布打包及离线测试依赖提取工具。
- lib/：生成的原生客户端 bundle，被 Git 忽略。
- deliverables/：生成的安装包、源码压缩包和本机验证记录，被 Git 忽略。
- runtime-test/：同版本 Desktop 测试依赖缓存，被 Git 忽略。
- tmp/：调研报告、参考源码、一次性探测工具、历史迁移辅助包和本机备份，统一归档并被 Git 忽略。

## 构建与测试

在项目根目录执行（Node 24.21 或兼容版本）：

```powershell
node scripts/build.mjs
node --import ./test/runtime-loader.mjs --test --test-isolation=none 'test/*.test.mjs'
```

客户端构建不安装依赖，直接使用宿主提供的 React。测试没有真实模型请求，默认使用 runtime-test/dsh/node_modules 中提取的 Desktop 0.2.2-rc.1 依赖。首次准备测试缓存：

```powershell
python scripts/extract-test-runtime.py
```

提取脚本默认读取本机 Desktop 安装 ASAR。也可设置 DSH_TEST_RUNTIME 为包含同版本 node_modules 的 dsh 运行时目录。缓存不进入 Git，原有依赖无需迁移进 tmp。

## 打包

先构建客户端，再打包：

```powershell
node scripts/build.mjs
python scripts/package-deliverables.py
```

输出位于 deliverables/。打包仅收集明确列出的项目文件，不收集 tmp、运行时缓存或 Git 数据。已有正式版本安装包不覆盖；同版本重建输出 -local.tgz，正式发布应先递增版本。

Git 不跟踪 lib，但它是安装包所需的生成物。新的源码检出应先执行构建，再打包。

## 当前安装路径

源码当前版本为 0.2.1，安装包由打包脚本生成。历史 0.1.3 安装包保留原位。只有通过插件管理器安装新包后，Desktop 才会使用独立模式；源码修改和构建不会自动替换已安装版本。

## 首次提交

设置你希望使用的作者身份后执行：

```powershell
git config user.name "你的姓名"
git config user.email "你的邮箱"
git commit -m "Initial import of desktop auto-review plugin"
```
