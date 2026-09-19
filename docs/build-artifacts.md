# 构建产物规范

## 固定入口

- `npm run release`：完整生产构建并整理到 `out/latest/`。日常只从这里启动 `Vibe Remote Buddy.exe`，复制时复制整个目录。
- `npm run release:archive`：完整构建，同时在 `out/releases/` 留一份不可覆盖的包目录。
- 归档名：`vibe-remote-buddy-app-<应用版本>-windows-<架构>-<UTC时间>-<提交前8位>[-dirty]`。压缩或对外发布时沿用该目录名，不另起名字。
- 应用版本来自 package.json / tauri.conf.json，不能拿固件版本给应用命名。
- 每份包包含 `build-info.json`：版本、提交、工作区是否修改、打包时间、平台和文件 SHA256。时间是打包时间，不冒充编译时间。

`src-tauri/target/`、`dist/` 是构建缓存，`build/` 是测试、日志和临时诊断资料，不是给用户的启动入口。禁止创建 `fixed`、`new`、`probe-080` 等随意命名的交付目录。调试资料使用 `build/diagnostics/<YYYYMMDD-HHMMSS>-<主题>/`。

## 操作约束

构建必须启用 custom-protocol，嵌入前端，禁止把依赖 localhost 的开发程序交付用户。不要单独拷贝 EXE；资源、许可证与构建信息必须一起提供。更新 latest 前退出正在运行的该目录程序；占用导致替换失败时应保留原包并报错，不换个名字绕过。

默认构建只更新 latest，不积累历史版本。归档须明确需要；历史 build 内的旧产物不自动删除，人工核实后归档或清理。`.staging` / `.previous` 是打包事务临时目录，存在时先检查上次操作，不得直接当成新版本启动。

通过 `node scripts/package.mjs --import-existing <旧目录>` 可迁移已验证的旧包到固定入口；其原构建版本和提交记为 unknown，不能把当前源码提交冒充旧包来源。此选项只用于历史整理，不替代构建。

Windows 当前经过验证；新增平台需要先扩展打包脚本并验证，不能把 Windows 便携包改名为 macOS/Linux 包。公开应用仓库不得混入内部固件。


Windows 便携包还包含 `resources/installer/`：独立烧录助手、运行库、许可证及源码。`BUDDY_FIRMWARE_DIR` 中存在 `install.json` 时才复制完整安装镜像；否则仍可管理接收器，但不能首次安装。禁止单独发布助手 EXE 或删除其 `_internal` 目录。正式构建需 Python 来构建助手，终端用户不需要 Python。
